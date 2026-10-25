-- =============================================================================
-- Migration 0008 — Text extracted from stored source files (DERIVED data).
--
--   source_text_extractions  one outcome per attempt for a source version:
--       extracted   text taken from the file's own text layer (PDF) or the file itself (TXT)
--       needs_ocr   no usable text layer (scanned PDF, image) — nothing is guessed
--   source_pages             the text of each page, exactly as extracted (never edited)
--
-- Originals are untouched: this text lives in its own tables, is labelled with the
-- method and extractor that produced it, and can be regenerated from the original.
-- Extraction runs only in the background worker (service role), never in a web request.
-- =============================================================================

alter table public.processing_jobs drop constraint processing_jobs_kind_check;
alter table public.processing_jobs add constraint processing_jobs_kind_check
  check (kind in ('verify_upload', 'extract_text'));

create table public.source_text_extractions (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null,
  project_id         uuid not null,
  source_version_id  uuid not null,
  job_id             uuid not null references public.processing_jobs (id),
  status             text not null check (status in ('extracted', 'needs_ocr')),
  method             text not null check (method in ('pdf_text_layer', 'plain_text', 'none')),
  extractor          text not null check (length(extractor) between 1 and 100),
  page_count         integer not null check (page_count >= 0 and page_count <= 5000),
  pages_with_text    integer not null check (pages_with_text >= 0 and pages_with_text <= page_count),
  created_at         timestamptz not null default now(),
  foreign key (source_version_id, org_id, project_id) references public.source_versions (id, org_id, project_id)
);
-- At most one outcome per source version.
create unique index source_text_extractions_version_uniq on public.source_text_extractions (source_version_id);

create table public.source_pages (
  source_version_id  uuid not null,
  org_id             uuid not null,
  project_id         uuid not null,
  page_number        integer not null check (page_number >= 1 and page_number <= 5000),
  text               text not null check (length(text) <= 200000),
  primary key (source_version_id, page_number),
  foreign key (source_version_id, org_id, project_id) references public.source_versions (id, org_id, project_id)
);

create trigger source_text_extractions_append_only before update or delete on public.source_text_extractions
  for each row execute function private.append_only();
create trigger source_pages_append_only before update or delete on public.source_pages
  for each row execute function private.append_only();
create trigger source_text_extractions_no_truncate before truncate on public.source_text_extractions
  for each statement execute function private.append_only();
create trigger source_pages_no_truncate before truncate on public.source_pages
  for each statement execute function private.append_only();

-- -----------------------------------------------------------------------------
-- Creating / re-queuing an extraction job (shared by the app and the worker).
-- -----------------------------------------------------------------------------
create function private.ensure_extraction_job(p_version_id uuid, p_runner text, p_requested_by uuid)
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
    raise exception 'only stored files can have text extracted' using errcode = 'check_violation';
  end if;

  insert into public.processing_jobs (org_id, project_id, kind, subject_id, idempotency_key, runner, requested_by)
  values (v_ver.org_id, v_ver.project_id, 'extract_text', v_ver.id, 'extract_text:' || v_ver.id, p_runner, p_requested_by)
  on conflict (idempotency_key) do nothing
  returning * into v_job;
  if found then
    return query select v_job.id, v_job.request_count, v_job.status::text, true;
    return;
  end if;

  select * into v_job from public.processing_jobs j where j.idempotency_key = 'extract_text:' || v_ver.id for update;
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
revoke execute on function private.ensure_extraction_job(uuid, text, uuid) from public;

-- App, as a signed-in admin/author: (re)request extraction for a stored file.
create function public.request_text_extraction(p_version_id uuid, p_runner text)
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
  return query select * from private.ensure_extraction_job(p_version_id, p_runner, auth.uid());
end;
$$;

-- Worker, right after a file is verified and stored.
create function public.worker_request_extraction(p_version_id uuid, p_runner text)
returns table (job_id uuid, request_count integer, status text, enqueue boolean)
language plpgsql security definer set search_path = ''
as $$
declare
  v_uploader uuid;
begin
  select sv.uploaded_by into v_uploader from public.source_versions sv where sv.id = p_version_id;
  return query select * from private.ensure_extraction_job(p_version_id, p_runner, v_uploader);
end;
$$;

-- Worker: record the outcome and the page texts in one transaction. Idempotent.
create function public.worker_finish_extraction(
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
    insert into public.source_pages (source_version_id, org_id, project_id, page_number, text)
    select v_ver.id, v_ver.org_id, v_ver.project_id, (p ->> 'page')::integer, coalesce(p ->> 'text', '')
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

revoke execute on function public.request_text_extraction(uuid, text) from public, anon;
grant execute on function public.request_text_extraction(uuid, text) to authenticated;
revoke execute on function public.worker_request_extraction(uuid, text) from public, anon, authenticated;
revoke execute on function public.worker_finish_extraction(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.worker_request_extraction(uuid, text) to service_role;
grant execute on function public.worker_finish_extraction(uuid, text, text, text, jsonb) to service_role;

-- -----------------------------------------------------------------------------
-- Audit (counts only, never text)
-- -----------------------------------------------------------------------------
create function private.source_text_extractions_audit()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.write_audit(new.org_id, new.project_id, 'source_text.' || new.status, 'source_version',
    new.source_version_id::text,
    jsonb_build_object('page_count', new.page_count, 'pages_with_text', new.pages_with_text, 'method', new.method));
  return null;
end;
$$;
create trigger source_text_extractions_audit after insert on public.source_text_extractions
  for each row execute function private.source_text_extractions_audit();

-- -----------------------------------------------------------------------------
-- Row Level Security: read-only for firm members
-- -----------------------------------------------------------------------------
alter table public.source_text_extractions enable row level security;
alter table public.source_pages enable row level security;
revoke all on public.source_text_extractions, public.source_pages from anon, authenticated;
grant select on public.source_text_extractions, public.source_pages to authenticated;
create policy source_text_extractions_select on public.source_text_extractions
  for select to authenticated using ((select private.is_org_member(org_id)));
create policy source_pages_select on public.source_pages
  for select to authenticated using ((select private.is_org_member(org_id)));
