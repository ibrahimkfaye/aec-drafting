-- =============================================================================
-- Migration 0010 — OCR text for files with no text layer (scans, photos).
--
-- OCR runs only on request (admin/author), only for stored files whose text
-- extraction found no text layer ("needs_ocr"), and only in the worker, with a
-- local OCR engine (no external service). Its text is DERIVED and less reliable
-- than a text layer, so every page records where its text came from and, for OCR,
-- the engine's own confidence score (an estimate, not a measure of accuracy).
--
--   source_pages.origin          text_layer | plain_text | ocr
--   source_pages.ocr_confidence  0–100, OCR pages only
--   source_ocr_results           one outcome per file: recognized | no_text_found
-- =============================================================================

alter table public.processing_jobs drop constraint processing_jobs_kind_check;
alter table public.processing_jobs add constraint processing_jobs_kind_check
  check (kind in ('verify_upload', 'extract_text', 'ocr_text'));

-- Where each page's text came from. Existing pages are labelled from their extraction.
alter table public.source_pages add column origin text;
alter table public.source_pages add column ocr_confidence numeric(5, 2);
alter table public.source_pages disable trigger source_pages_append_only;
update public.source_pages p
   set origin = case e.method when 'plain_text' then 'plain_text' else 'text_layer' end
  from public.source_text_extractions e
 where e.source_version_id = p.source_version_id;
alter table public.source_pages enable trigger source_pages_append_only;
alter table public.source_pages alter column origin set not null;
alter table public.source_pages add constraint source_pages_origin_check
  check (origin in ('text_layer', 'plain_text', 'ocr'));
alter table public.source_pages add constraint source_pages_confidence_check
  check ((origin = 'ocr') = (ocr_confidence is not null) and (ocr_confidence is null or ocr_confidence between 0 and 100));

-- Text-layer extraction now labels the pages it writes.
create or replace function public.worker_finish_extraction(
  p_job_id uuid, p_status text, p_method text, p_extractor text, p_pages jsonb
) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_job public.processing_jobs%rowtype;
  v_ver public.source_versions%rowtype;
  v_pages integer := coalesce(jsonb_array_length(p_pages), 0);
  v_with_text integer;
begin
  select * into v_job from public.processing_jobs j where j.id = p_job_id for update;
  if not found or v_job.kind <> 'extract_text' then
    raise exception 'job not found' using errcode = 'no_data_found';
  end if;
  select * into v_ver from public.source_versions sv where sv.id = v_job.subject_id;

  if exists (select 1 from public.source_text_extractions e where e.source_version_id = v_ver.id) then
    update public.processing_jobs set status = 'succeeded', finished_at = now(), error_code = null where id = v_job.id;
    return 'already_extracted';
  end if;

  if p_status = 'extracted' then
    insert into public.source_pages (source_version_id, org_id, project_id, page_number, text, origin)
    select v_ver.id, v_ver.org_id, v_ver.project_id, (p ->> 'page')::integer, coalesce(p ->> 'text', ''),
           case p_method when 'plain_text' then 'plain_text' else 'text_layer' end
      from jsonb_array_elements(p_pages) p;
  end if;
  select count(*) into v_with_text from jsonb_array_elements(coalesce(p_pages, '[]'::jsonb)) p
   where length(btrim(coalesce(p ->> 'text', ''))) > 0;

  insert into public.source_text_extractions
    (org_id, project_id, source_version_id, job_id, status, method, extractor, page_count, pages_with_text)
  values
    (v_ver.org_id, v_ver.project_id, v_ver.id, v_job.id, p_status, p_method, p_extractor, v_pages,
     case when p_status = 'extracted' then v_with_text else 0 end);

  update public.processing_jobs set status = 'succeeded', finished_at = now(), error_code = null where id = v_job.id;
  return p_status;
end;
$$;

create table public.source_ocr_results (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null,
  project_id         uuid not null,
  source_version_id  uuid not null,
  job_id             uuid not null references public.processing_jobs (id),
  status             text not null check (status in ('recognized', 'no_text_found')),
  engine             text not null check (length(engine) between 1 and 200),
  language           text not null check (language ~ '^[a-z_+]{3,40}$'),
  render_dpi         integer check (render_dpi between 50 and 600),         -- PDFs only
  page_count         integer not null check (page_count between 0 and 5000),
  pages_with_text    integer not null check (pages_with_text between 0 and page_count),
  mean_confidence    numeric(5, 2) check (mean_confidence between 0 and 100),
  created_at         timestamptz not null default now(),
  foreign key (source_version_id, org_id, project_id) references public.source_versions (id, org_id, project_id)
);
create unique index source_ocr_results_version_uniq on public.source_ocr_results (source_version_id);

create trigger source_ocr_results_append_only before update or delete on public.source_ocr_results
  for each row execute function private.append_only();
create trigger source_ocr_results_no_truncate before truncate on public.source_ocr_results
  for each statement execute function private.append_only();

-- -----------------------------------------------------------------------------
-- Requesting OCR. Only for stored files whose extraction found no text layer.
-- -----------------------------------------------------------------------------
create function private.ensure_ocr_job(p_version_id uuid, p_runner text, p_requested_by uuid)
returns table (job_id uuid, request_count integer, status text, enqueue boolean)
language plpgsql security definer set search_path = ''
as $$
declare
  v_ver public.source_versions%rowtype;
  v_job public.processing_jobs%rowtype;
begin
  if p_runner not in ('local', 'trigger') then
    raise exception 'unknown runner' using errcode = 'check_violation';
  end if;
  select * into v_ver from public.source_versions sv where sv.id = p_version_id;
  if not found or v_ver.status <> 'stored' then
    raise exception 'only stored files can be OCR''d' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.source_text_extractions e
                  where e.source_version_id = v_ver.id and e.status = 'needs_ocr') then
    raise exception 'OCR is only for files with no text layer' using errcode = 'check_violation';
  end if;

  insert into public.processing_jobs (org_id, project_id, kind, subject_id, idempotency_key, runner, requested_by)
  values (v_ver.org_id, v_ver.project_id, 'ocr_text', v_ver.id, 'ocr_text:' || v_ver.id, p_runner, p_requested_by)
  on conflict (idempotency_key) do nothing
  returning * into v_job;
  if found then
    return query select v_job.id, v_job.request_count, v_job.status::text, true;
    return;
  end if;

  select * into v_job from public.processing_jobs j where j.idempotency_key = 'ocr_text:' || v_ver.id for update;
  if v_job.status = 'failed' then
    update public.processing_jobs j
       set status = 'queued', request_count = j.request_count + 1, error_code = null, finished_at = null, runner = p_runner
     where j.id = v_job.id
     returning * into v_job;
    return query select v_job.id, v_job.request_count, v_job.status::text, true;
    return;
  end if;
  return query select v_job.id, v_job.request_count, v_job.status::text, v_job.status = 'queued';
end;
$$;
revoke execute on function private.ensure_ocr_job(uuid, text, uuid) from public;

-- App, as a signed-in admin/author.
create function public.request_ocr(p_version_id uuid, p_runner text)
returns table (job_id uuid, request_count integer, status text, enqueue boolean)
language plpgsql security definer set search_path = ''
as $$
declare
  v_project uuid;
begin
  select sv.project_id into v_project from public.source_versions sv where sv.id = p_version_id;
  if v_project is null then
    raise exception 'file not found or not allowed' using errcode = 'insufficient_privilege';
  end if;
  perform private.writable_project(v_project, array['admin', 'author']::public.member_role[]);
  return query select * from private.ensure_ocr_job(p_version_id, p_runner, auth.uid());
end;
$$;

-- Worker: record the OCR outcome and page texts in one transaction. Idempotent.
-- p_pages: [{ "page": 1, "text": "...", "confidence": 87.5 }, ...]
create function public.worker_finish_ocr(
  p_job_id uuid, p_status text, p_engine text, p_language text, p_render_dpi integer, p_pages jsonb
) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_job public.processing_jobs%rowtype;
  v_ver public.source_versions%rowtype;
  v_pages integer := coalesce(jsonb_array_length(p_pages), 0);
  v_with_text integer;
  v_mean numeric;
begin
  select * into v_job from public.processing_jobs j where j.id = p_job_id for update;
  if not found or v_job.kind <> 'ocr_text' then
    raise exception 'job not found' using errcode = 'no_data_found';
  end if;
  select * into v_ver from public.source_versions sv where sv.id = v_job.subject_id;
  if v_ver.status <> 'stored' or not exists (
       select 1 from public.source_text_extractions e where e.source_version_id = v_ver.id and e.status = 'needs_ocr') then
    raise exception 'OCR is only for files with no text layer' using errcode = 'check_violation';
  end if;

  if exists (select 1 from public.source_ocr_results r where r.source_version_id = v_ver.id) then
    update public.processing_jobs set status = 'succeeded', finished_at = now(), error_code = null where id = v_job.id;
    return 'already_done';
  end if;

  if p_status = 'recognized' then
    insert into public.source_pages (source_version_id, org_id, project_id, page_number, text, origin, ocr_confidence)
    select v_ver.id, v_ver.org_id, v_ver.project_id, (p ->> 'page')::integer, coalesce(p ->> 'text', ''), 'ocr',
           (p ->> 'confidence')::numeric
      from jsonb_array_elements(p_pages) p;
  end if;
  select count(*), avg((p ->> 'confidence')::numeric) filter (where length(btrim(coalesce(p ->> 'text', ''))) > 0)
    into v_pages, v_mean
    from jsonb_array_elements(coalesce(p_pages, '[]'::jsonb)) p;
  select count(*) into v_with_text from jsonb_array_elements(coalesce(p_pages, '[]'::jsonb)) p
   where length(btrim(coalesce(p ->> 'text', ''))) > 0;

  insert into public.source_ocr_results
    (org_id, project_id, source_version_id, job_id, status, engine, language, render_dpi, page_count, pages_with_text, mean_confidence)
  values
    (v_ver.org_id, v_ver.project_id, v_ver.id, v_job.id, p_status, p_engine, p_language, p_render_dpi, v_pages,
     case when p_status = 'recognized' then v_with_text else 0 end,
     case when p_status = 'recognized' then round(v_mean, 2) end);

  update public.processing_jobs set status = 'succeeded', finished_at = now(), error_code = null where id = v_job.id;
  return p_status;
end;
$$;

revoke execute on function public.request_ocr(uuid, text) from public, anon;
grant execute on function public.request_ocr(uuid, text) to authenticated;
revoke execute on function public.worker_finish_ocr(uuid, text, text, text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.worker_finish_ocr(uuid, text, text, text, integer, jsonb) to service_role;

-- -----------------------------------------------------------------------------
-- Audit (counts only, never text)
-- -----------------------------------------------------------------------------
create function private.source_ocr_results_audit()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.write_audit(new.org_id, new.project_id, 'source_text.ocr_' || new.status, 'source_version',
    new.source_version_id::text,
    jsonb_strip_nulls(jsonb_build_object('page_count', new.page_count, 'pages_with_text', new.pages_with_text,
                                         'mean_confidence', new.mean_confidence)));
  return null;
end;
$$;
create trigger source_ocr_results_audit after insert on public.source_ocr_results
  for each row execute function private.source_ocr_results_audit();

alter table public.source_ocr_results enable row level security;
revoke all on public.source_ocr_results from anon, authenticated;
grant select on public.source_ocr_results to authenticated;
create policy source_ocr_results_select on public.source_ocr_results
  for select to authenticated using ((select private.is_org_member(org_id)));
