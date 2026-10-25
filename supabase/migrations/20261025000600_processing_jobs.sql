-- =============================================================================
-- Migration 0006 — Background processing jobs; upload verification moves to a worker.
--
-- Why: on Vercel, the app server must not pull large files through itself.
-- Checking a stored file's contents now runs in a background worker
-- (Trigger.dev in preview/production; an in-process runner for local dev only).
--
-- Security change: users can no longer mark their own upload "stored".
-- complete_source_upload() (callable by the uploader) is DROPPED. Only the worker,
-- using the server-side service role, can finish an upload — closing gap S-02.
--
--   processing_jobs  one row per unit of background work, visible to firm members.
--                    queued -> running -> succeeded | failed ; failed -> queued (retry)
-- =============================================================================

create type public.job_status as enum ('queued', 'running', 'succeeded', 'failed');

create table public.processing_jobs (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null,
  project_id       uuid not null,
  kind             text not null check (kind in ('verify_upload')),
  subject_id       uuid not null,                         -- e.g. the source_version id
  idempotency_key  text not null unique,                  -- one job per subject+kind
  runner           text not null check (runner in ('local', 'trigger')),
  status           public.job_status not null default 'queued',
  request_count    integer not null default 1 check (request_count >= 1),
  attempts         integer not null default 0 check (attempts >= 0),
  external_run_id  text check (length(external_run_id) <= 200),
  error_code       text check (error_code ~ '^[a-z_]{1,64}$'),   -- codes only, never content
  requested_by     uuid not null references auth.users (id),
  created_at       timestamptz not null default now(),
  started_at       timestamptz,
  finished_at      timestamptz,
  foreign key (project_id, org_id) references public.projects (id, org_id)
);
create index processing_jobs_subject_idx on public.processing_jobs (subject_id);
create index processing_jobs_project_idx on public.processing_jobs (project_id, created_at desc);

create trigger processing_jobs_no_delete before delete on public.processing_jobs
  for each row execute function private.append_only();
create trigger processing_jobs_no_truncate before truncate on public.processing_jobs
  for each statement execute function private.append_only();

-- -----------------------------------------------------------------------------
-- Remove the user-callable completion path.
-- -----------------------------------------------------------------------------
drop function public.complete_source_upload(uuid, text, text, text);

-- -----------------------------------------------------------------------------
-- Called by the app AS THE UPLOADER after the browser finishes sending bytes.
-- Idempotent: repeated calls return the same job; a failed job is re-queued.
-- Returns enqueue = true when the caller should hand the job to a runner: for a
-- new or re-queued job, and also for a job still 'queued' (in case the previous
-- hand-off never reached the runner). Duplicate hand-offs are harmless: the
-- runner de-duplicates on (job_id, request_count) and finishing is idempotent.
-- -----------------------------------------------------------------------------
create function public.request_upload_verification(p_version_id uuid, p_runner text)
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
  if not found or v_ver.uploaded_by is distinct from auth.uid() then
    raise exception 'upload not found or not yours' using errcode = 'insufficient_privilege';
  end if;
  perform private.writable_project(v_ver.project_id, array['admin', 'author']::public.member_role[]);
  if v_ver.status <> 'uploading' then
    raise exception 'upload already finished' using errcode = 'check_violation';
  end if;

  insert into public.processing_jobs (org_id, project_id, kind, subject_id, idempotency_key, runner, requested_by)
  values (v_ver.org_id, v_ver.project_id, 'verify_upload', v_ver.id, 'verify_upload:' || v_ver.id, p_runner, auth.uid())
  on conflict (idempotency_key) do nothing
  returning * into v_job;
  if found then
    return query select v_job.id, v_job.request_count, v_job.status::text, true;
    return;
  end if;

  select * into v_job from public.processing_jobs j where j.idempotency_key = 'verify_upload:' || v_ver.id for update;
  if v_job.status = 'failed' then
    update public.processing_jobs j
       set status = 'queued', request_count = j.request_count + 1, error_code = null,
           finished_at = null, runner = p_runner
     where j.id = v_job.id
     returning * into v_job;
    return query select v_job.id, v_job.request_count, v_job.status::text, true;
    return;
  end if;
  return query select v_job.id, v_job.request_count, v_job.status::text, v_job.status = 'queued';
end;
$$;

revoke execute on function public.request_upload_verification(uuid, text) from public, anon;
grant execute on function public.request_upload_verification(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Worker functions: SERVICE ROLE ONLY (never granted to signed-in users).
-- -----------------------------------------------------------------------------
create function public.worker_start_job(p_job_id uuid, p_external_run_id text)
returns table (kind text, subject_id uuid, status text, storage_path text, original_filename text, byte_size bigint)
language plpgsql security definer set search_path = ''
as $$
declare
  v_job public.processing_jobs%rowtype;
  v_ver public.source_versions%rowtype;
begin
  select * into v_job from public.processing_jobs j where j.id = p_job_id for update;
  if not found then
    raise exception 'job not found' using errcode = 'no_data_found';
  end if;
  if v_job.status in ('queued', 'running', 'failed') then
    update public.processing_jobs j
       set status = 'running', attempts = j.attempts + 1, started_at = coalesce(j.started_at, now()),
           external_run_id = coalesce(p_external_run_id, j.external_run_id), error_code = null, finished_at = null
     where j.id = v_job.id
     returning * into v_job;
  end if;
  select * into v_ver from public.source_versions sv where sv.id = v_job.subject_id;
  return query select v_job.kind, v_job.subject_id, v_job.status::text, v_ver.storage_path,
                      v_ver.original_filename, v_ver.byte_size;
end;
$$;

-- Finishes the upload a verify_upload job is about. Idempotent: if the version
-- is already finished (e.g. a retried worker), it only marks the job succeeded.
create function public.worker_finish_upload(
  p_job_id uuid, p_sha256 text, p_detected_type text, p_block_reason text
) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_job public.processing_jobs%rowtype;
  v_ver public.source_versions%rowtype;
  v_size bigint;
  v_result text;
begin
  select * into v_job from public.processing_jobs j where j.id = p_job_id for update;
  if not found or v_job.kind <> 'verify_upload' then
    raise exception 'job not found' using errcode = 'no_data_found';
  end if;
  select * into v_ver from public.source_versions sv where sv.id = v_job.subject_id for update;

  if v_ver.status <> 'uploading' then
    v_result := v_ver.status::text;                   -- already finished: nothing to change
  elsif p_block_reason is null then
    select (o.metadata ->> 'size')::bigint into v_size
      from storage.objects o where o.bucket_id = 'project-files' and o.name = v_ver.storage_path;
    if v_size is null then
      p_block_reason := 'missing_upload';
    elsif v_size <> v_ver.byte_size then
      p_block_reason := 'size_mismatch';
    end if;
  end if;

  if v_result is null and p_block_reason is null then
    update public.source_versions
       set status = 'stored', sha256 = p_sha256, detected_type = p_detected_type, completed_at = now()
     where id = v_ver.id;
    v_result := 'stored';
  elsif v_result is null then
    update public.source_versions
       set status = 'blocked', block_reason = p_block_reason, completed_at = now()
     where id = v_ver.id;
    v_result := 'blocked';
  end if;

  update public.processing_jobs set status = 'succeeded', finished_at = now(), error_code = null where id = v_job.id;
  return v_result;
end;
$$;

-- Records a failure the worker could not recover from (after its own retries).
create function public.worker_fail_job(p_job_id uuid, p_error_code text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.processing_jobs
     set status = 'failed', finished_at = now(), error_code = p_error_code
   where id = p_job_id and status in ('queued', 'running');
end;
$$;

revoke execute on function public.worker_start_job(uuid, text) from public, anon, authenticated;
revoke execute on function public.worker_finish_upload(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.worker_fail_job(uuid, text) from public, anon, authenticated;
grant execute on function public.worker_start_job(uuid, text) to service_role;
grant execute on function public.worker_finish_upload(uuid, text, text, text) to service_role;
grant execute on function public.worker_fail_job(uuid, text) to service_role;

-- -----------------------------------------------------------------------------
-- Audit (codes and ids only)
-- -----------------------------------------------------------------------------
create function private.processing_jobs_audit()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or (new.status = 'queued' and old.status = 'failed') then
    perform private.write_audit(new.org_id, new.project_id, 'job.queued', 'processing_job', new.id::text,
      jsonb_build_object('kind', new.kind, 'subject_id', new.subject_id, 'request_count', new.request_count));
  elsif new.status in ('succeeded', 'failed') and old.status is distinct from new.status then
    perform private.write_audit(new.org_id, new.project_id, 'job.' || new.status::text, 'processing_job', new.id::text,
      jsonb_strip_nulls(jsonb_build_object('kind', new.kind, 'subject_id', new.subject_id,
                                           'attempts', new.attempts, 'error_code', new.error_code)));
  end if;
  return null;
end;
$$;

create trigger processing_jobs_audit after insert or update on public.processing_jobs
  for each row execute function private.processing_jobs_audit();

-- -----------------------------------------------------------------------------
-- Row Level Security: firm members can see job status; no direct writes.
-- -----------------------------------------------------------------------------
alter table public.processing_jobs enable row level security;
revoke all on public.processing_jobs from anon, authenticated;
grant select on public.processing_jobs to authenticated;
create policy processing_jobs_select on public.processing_jobs
  for select to authenticated using ((select private.is_org_member(org_id)));
