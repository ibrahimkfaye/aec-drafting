-- =============================================================================
-- Migration 0009 — Cleanup of file bytes that should not be kept (closes gap S-03).
--
-- Two kinds of upload leave unusable bytes in the private bucket:
--   * blocked after upload  (contents failed the checks, e.g. a ".pdf" that isn't a PDF)
--   * abandoned uploads     (still "uploading" long after the one-time upload link expired)
--
-- The database decides WHAT may be deleted; the worker (service role only) deletes
-- through the Storage API and then records the deletion. A deletion is recorded only
-- once the object is really gone. Stored files can never be selected for deletion.
-- The version row, its audit history and its SHA-256 (if any) are kept forever.
-- =============================================================================

-- New block reason for abandoned uploads.
alter table public.source_versions drop constraint source_versions_block_reason_check;
alter table public.source_versions add constraint source_versions_block_reason_check
  check (block_reason in ('unsupported_type', 'too_large', 'empty_file', 'signature_mismatch',
                          'invalid_text', 'size_mismatch', 'missing_upload', 'abandoned_upload'));

create table public.source_bytes_cleared (
  source_version_id  uuid primary key,
  org_id             uuid not null,
  project_id         uuid not null,
  cleared_at         timestamptz not null default now(),
  foreign key (source_version_id, org_id, project_id) references public.source_versions (id, org_id, project_id)
);

create trigger source_bytes_cleared_append_only before update or delete on public.source_bytes_cleared
  for each row execute function private.append_only();
create trigger source_bytes_cleared_no_truncate before truncate on public.source_bytes_cleared
  for each statement execute function private.append_only();

-- -----------------------------------------------------------------------------
-- Abandoned uploads -> blocked. Only uploads older than 24 hours (the upload link
-- expires after 2), and never one whose verification job is queued or running.
-- -----------------------------------------------------------------------------
create function public.worker_block_abandoned_uploads(p_older_than interval)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_older_than is null or p_older_than < interval '24 hours' then
    raise exception 'abandoned uploads must be at least 24 hours old' using errcode = 'check_violation';
  end if;
  with stale as (
    select sv.id from public.source_versions sv
     where sv.status = 'uploading'
       and sv.created_at < now() - p_older_than
       and not exists (select 1 from public.processing_jobs j
                        where j.subject_id = sv.id and j.kind = 'verify_upload'
                          and j.status in ('queued', 'running'))
     for update of sv skip locked
  )
  update public.source_versions sv
     set status = 'blocked', block_reason = 'abandoned_upload', completed_at = now()
    from stale where sv.id = stale.id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- Blocked versions not yet confirmed clear, plus any whose object exists again
-- (bytes re-sent after an earlier cleanup while an upload link was still valid).
-- The worker deletes each storage_path (deleting a missing object is harmless),
-- then records it. Pass a version id to check just that one.
-- -----------------------------------------------------------------------------
create function public.worker_bytes_to_clear(p_version_id uuid, p_limit integer)
returns table (version_id uuid, storage_path text)
language sql stable security definer set search_path = ''
as $$
  select sv.id, sv.storage_path
    from public.source_versions sv
   where sv.status = 'blocked'
     and sv.storage_path is not null
     and (p_version_id is null or sv.id = p_version_id)
     and (not exists (select 1 from public.source_bytes_cleared c where c.source_version_id = sv.id)
          or exists (select 1 from storage.objects o
                      where o.bucket_id = 'project-files' and o.name = sv.storage_path))
   order by sv.completed_at
   limit least(greatest(coalesce(p_limit, 100), 1), 1000);
$$;

-- Records that a blocked version's bytes are not kept. Refuses if the version is not
-- blocked or its object still exists. Returns true if this call recorded it.
create function public.worker_record_bytes_cleared(p_version_id uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_ver public.source_versions%rowtype;
  v_rows integer;
begin
  select * into v_ver from public.source_versions sv where sv.id = p_version_id;
  if not found or v_ver.status <> 'blocked' then
    raise exception 'only blocked files can be cleared' using errcode = 'check_violation';
  end if;
  if v_ver.storage_path is not null and exists (
       select 1 from storage.objects o where o.bucket_id = 'project-files' and o.name = v_ver.storage_path) then
    raise exception 'file bytes still present' using errcode = 'check_violation';
  end if;
  insert into public.source_bytes_cleared (source_version_id, org_id, project_id)
  values (v_ver.id, v_ver.org_id, v_ver.project_id)
  on conflict (source_version_id) do nothing;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

revoke execute on function public.worker_block_abandoned_uploads(interval) from public, anon, authenticated;
revoke execute on function public.worker_bytes_to_clear(uuid, integer) from public, anon, authenticated;
revoke execute on function public.worker_record_bytes_cleared(uuid) from public, anon, authenticated;
grant execute on function public.worker_block_abandoned_uploads(interval) to service_role;
grant execute on function public.worker_bytes_to_clear(uuid, integer) to service_role;
grant execute on function public.worker_record_bytes_cleared(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- Audit (ids only)
-- -----------------------------------------------------------------------------
create function private.source_bytes_cleared_audit()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.write_audit(new.org_id, new.project_id, 'source_version.bytes_cleared', 'source_version',
    new.source_version_id::text, '{}'::jsonb);
  return null;
end;
$$;
create trigger source_bytes_cleared_audit after insert on public.source_bytes_cleared
  for each row execute function private.source_bytes_cleared_audit();

-- -----------------------------------------------------------------------------
-- Row Level Security: firm members can see that bytes were cleared; no writes.
-- -----------------------------------------------------------------------------
alter table public.source_bytes_cleared enable row level security;
revoke all on public.source_bytes_cleared from anon, authenticated;
grant select on public.source_bytes_cleared to authenticated;
create policy source_bytes_cleared_select on public.source_bytes_cleared
  for select to authenticated using ((select private.is_org_member(org_id)));
