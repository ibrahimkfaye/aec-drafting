-- =============================================================================
-- Migration 0003 — Project source files (originals only) and private storage.
--
-- Model
--   sources          one logical document within a project ("Site survey notes")
--   source_versions  each uploaded file for that source; immutable once finished
--
-- Upload protocol (see docs/ARCHITECTURE.md "File uploads")
--   1. app server calls begin_source_upload()  -> row status 'uploading' (or
--      'blocked' straight away for unsupported/oversized/empty files)
--   2. browser uploads bytes directly to the private bucket at the row's
--      storage_path (allowed ONLY while that row is 'uploading' and only for
--      the uploader)
--   3. app server re-reads the stored bytes, checks size/signature/hash and
--      calls complete_source_upload() -> 'stored' or 'blocked'
--
-- Derived files (OCR text, page images, crops) are NOT stored here; they get
-- their own table in Phase 2 so originals and derivatives are never confused.
-- =============================================================================

create type public.source_version_status as enum ('uploading', 'stored', 'blocked');
create type public.scan_status as enum ('not_scanned', 'clean', 'infected', 'scan_error');

create table public.sources (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  project_id  uuid not null,
  title       text not null check (length(btrim(title)) between 1 and 255),
  created_by  uuid not null references auth.users (id),
  created_at  timestamptz not null default now(),
  foreign key (project_id, org_id) references public.projects (id, org_id),
  unique (id, org_id, project_id)
);
create index sources_project_idx on public.sources (project_id, created_at);

create table public.source_versions (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null,
  project_id         uuid not null,
  source_id          uuid not null,
  version_number     integer not null check (version_number >= 1),
  original_filename  text not null check (length(original_filename) between 1 and 255),
  byte_size          bigint not null check (byte_size >= 0),
  declared_mime      text not null default '' check (length(declared_mime) <= 255),
  detected_type      text check (detected_type in ('pdf', 'png', 'jpeg', 'text')),
  sha256             text check (sha256 ~ '^[0-9a-f]{64}$'),
  storage_path       text unique,
  status             public.source_version_status not null,
  block_reason       text check (block_reason in
                       ('unsupported_type', 'too_large', 'empty_file', 'signature_mismatch',
                        'invalid_text', 'size_mismatch', 'missing_upload')),
  scan_status        public.scan_status not null default 'not_scanned',
  uploaded_by        uuid not null references auth.users (id),
  created_at         timestamptz not null default now(),
  completed_at       timestamptz,
  foreign key (source_id, org_id, project_id) references public.sources (id, org_id, project_id),
  unique (source_id, version_number),
  -- Status must agree with the other fields.
  check (status <> 'stored' or (sha256 is not null and detected_type is not null
                                and storage_path is not null and block_reason is null
                                and completed_at is not null)),
  check (status <> 'blocked' or (block_reason is not null and completed_at is not null)),
  check (status <> 'uploading' or (storage_path is not null and block_reason is null))
);
create index source_versions_project_idx on public.source_versions (project_id, source_id, version_number);

-- -----------------------------------------------------------------------------
-- Integrity: versions are immutable except the single 'uploading' -> final step
-- and (later, operator/scanner only) scan_status on stored files. No deletes.
-- -----------------------------------------------------------------------------
create function private.source_versions_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'source versions cannot be deleted' using errcode = 'insufficient_privilege';
  end if;
  if new.id <> old.id or new.org_id <> old.org_id or new.project_id <> old.project_id
     or new.source_id <> old.source_id or new.version_number <> old.version_number
     or new.original_filename <> old.original_filename or new.byte_size <> old.byte_size
     or new.declared_mime <> old.declared_mime or new.storage_path is distinct from old.storage_path
     or new.uploaded_by <> old.uploaded_by or new.created_at <> old.created_at then
    raise exception 'source version identity fields are immutable' using errcode = 'check_violation';
  end if;
  if old.status <> 'uploading' and (
       new.status is distinct from old.status or new.sha256 is distinct from old.sha256
       or new.detected_type is distinct from old.detected_type
       or new.block_reason is distinct from old.block_reason
       or new.completed_at is distinct from old.completed_at) then
    raise exception 'a finished upload cannot be changed' using errcode = 'check_violation';
  end if;
  if new.scan_status is distinct from old.scan_status and new.status <> 'stored' then
    raise exception 'only stored files can have a scan result' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger source_versions_guard
  before update or delete on public.source_versions
  for each row execute function private.source_versions_guard();

create trigger source_versions_no_truncate
  before truncate on public.source_versions
  for each statement execute function private.audit_events_immutable();

-- -----------------------------------------------------------------------------
-- Step 1: begin an upload (or record a blocked file).
-- SECURITY DEFINER so it can number versions atomically; it re-checks every
-- permission itself because it bypasses row-level security.
-- -----------------------------------------------------------------------------
create function public.begin_source_upload(
  p_project_id   uuid,
  p_source_id    uuid,      -- null = new source; otherwise add a version to it
  p_filename     text,
  p_byte_size    bigint,
  p_declared_mime text,
  p_block_reason text       -- null = proceed with upload; else record as blocked
) returns table (source_id uuid, version_id uuid, version_number integer, storage_path text, status text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_project  public.projects%rowtype;
  v_source   uuid := p_source_id;
  v_version  uuid := gen_random_uuid();
  v_number   integer;
  v_path     text;
  v_status   public.source_version_status;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  select * into v_project from public.projects p where p.id = p_project_id for share;
  if not found or not private.has_org_role(v_project.org_id, array['admin', 'author']::public.member_role[]) then
    -- Same error whether the project is missing or belongs to another firm.
    raise exception 'project not found or not allowed' using errcode = 'insufficient_privilege';
  end if;
  if v_project.status <> 'active' then
    raise exception 'project is archived' using errcode = 'check_violation';
  end if;

  if p_block_reason is null and (p_byte_size <= 0 or p_byte_size > 26214400) then
    raise exception 'file size must be 1 byte to 25 MB unless the file is recorded as blocked'
      using errcode = 'check_violation';
  end if;
  if p_filename ~ '[[:cntrl:]]' then
    raise exception 'filename contains control characters' using errcode = 'check_violation';
  end if;

  if v_source is null then
    insert into public.sources (org_id, project_id, title, created_by)
    values (v_project.org_id, v_project.id, p_filename, v_uid)
    returning id into v_source;
  else
    -- Lock the source so concurrent uploads get distinct version numbers.
    perform 1 from public.sources s
      where s.id = v_source and s.project_id = v_project.id and s.org_id = v_project.org_id
      for update;
    if not found then
      raise exception 'source not found in this project' using errcode = 'insufficient_privilege';
    end if;
  end if;

  select coalesce(max(sv.version_number), 0) + 1 into v_number
    from public.source_versions sv where sv.source_id = v_source;

  if p_block_reason is null then
    v_status := 'uploading';
    v_path := v_project.org_id || '/' || v_project.id || '/' || v_source || '/' || v_version;
  else
    v_status := 'blocked';
    v_path := null;   -- blocked files are never stored
  end if;

  insert into public.source_versions
    (id, org_id, project_id, source_id, version_number, original_filename, byte_size,
     declared_mime, storage_path, status, block_reason, uploaded_by, completed_at)
  values
    (v_version, v_project.org_id, v_project.id, v_source, v_number, p_filename, p_byte_size,
     coalesce(p_declared_mime, ''), v_path, v_status, p_block_reason, v_uid,
     case when v_status = 'blocked' then now() end);

  return query select v_source, v_version, v_number, v_path, v_status::text;
end;
$$;

-- -----------------------------------------------------------------------------
-- Step 3: finish an upload after the app server has checked the stored bytes.
-- 'stored' requires the object to exist with exactly the declared size.
-- -----------------------------------------------------------------------------
create function public.complete_source_upload(
  p_version_id    uuid,
  p_sha256        text,
  p_detected_type text,
  p_block_reason  text      -- null = mark stored; else mark blocked
) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_row  public.source_versions%rowtype;
  v_size bigint;
begin
  select * into v_row from public.source_versions sv where sv.id = p_version_id for update;
  if not found or v_row.uploaded_by is distinct from v_uid then
    raise exception 'upload not found or not yours' using errcode = 'insufficient_privilege';
  end if;
  if v_row.status <> 'uploading' then
    raise exception 'upload already finished' using errcode = 'check_violation';
  end if;

  if p_block_reason is null then
    select (o.metadata ->> 'size')::bigint into v_size
      from storage.objects o
     where o.bucket_id = 'project-files' and o.name = v_row.storage_path;
    if v_size is null then
      raise exception 'uploaded file not found in storage' using errcode = 'check_violation';
    end if;
    if v_size <> v_row.byte_size then
      raise exception 'stored size does not match declared size' using errcode = 'check_violation';
    end if;
    update public.source_versions
       set status = 'stored', sha256 = p_sha256, detected_type = p_detected_type, completed_at = now()
     where id = p_version_id;
    return 'stored';
  end if;

  update public.source_versions
     set status = 'blocked', block_reason = p_block_reason, completed_at = now()
   where id = p_version_id;
  return 'blocked';
end;
$$;

revoke execute on function public.begin_source_upload(uuid, uuid, text, bigint, text, text) from public, anon;
revoke execute on function public.complete_source_upload(uuid, text, text, text) from public, anon;
grant execute on function public.begin_source_upload(uuid, uuid, text, bigint, text, text) to authenticated;
grant execute on function public.complete_source_upload(uuid, text, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Audit (metadata only — never filenames or content)
-- -----------------------------------------------------------------------------
create function private.source_versions_audit()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_action text;
begin
  if tg_op = 'INSERT' then
    v_action := case when new.status = 'blocked' then 'source_version.blocked' else 'source_version.upload_started' end;
  elsif new.status is distinct from old.status then
    v_action := 'source_version.' || new.status::text;   -- stored | blocked
  elsif new.scan_status is distinct from old.scan_status then
    v_action := 'source_version.scan_' || new.scan_status::text;
  else
    return null;
  end if;
  perform private.write_audit(new.org_id, new.project_id, v_action, 'source_version', new.id::text,
    jsonb_strip_nulls(jsonb_build_object(
      'source_id', new.source_id, 'version_number', new.version_number, 'byte_size', new.byte_size,
      'detected_type', new.detected_type, 'block_reason', new.block_reason)));
  return null;
end;
$$;

create trigger source_versions_audit
  after insert or update on public.source_versions
  for each row execute function private.source_versions_audit();

-- -----------------------------------------------------------------------------
-- Row Level Security: read-only for firm members; all writes go through the
-- functions above.
-- -----------------------------------------------------------------------------
alter table public.sources enable row level security;
alter table public.source_versions enable row level security;
revoke all on public.sources, public.source_versions from anon, authenticated;
grant select on public.sources, public.source_versions to authenticated;

create policy sources_select on public.sources
  for select to authenticated using ((select private.is_org_member(org_id)));
create policy source_versions_select on public.source_versions
  for select to authenticated using ((select private.is_org_member(org_id)));

-- -----------------------------------------------------------------------------
-- Private bucket + storage policies
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('project-files', 'project-files', false, 26214400,
        array['application/pdf', 'image/png', 'image/jpeg', 'text/plain'])
on conflict (id) do nothing;

-- May the current user upload to this exact path? Only the uploader, only
-- while their version row is still 'uploading'.
create function private.can_upload_object(p_name text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.source_versions sv
     where sv.storage_path = p_name and sv.status = 'uploading'
       and sv.uploaded_by = (select auth.uid())
       and private.has_org_role(sv.org_id, array['admin', 'author']::public.member_role[])
  );
$$;

-- May the current user read this object? Firm members may read stored files;
-- the uploader may also read their own in-progress upload (for verification).
-- Blocked files are never readable.
create function private.can_read_object(p_name text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.source_versions sv
     where sv.storage_path = p_name
       and private.is_org_member(sv.org_id)
       and (sv.status = 'stored'
            or (sv.status = 'uploading' and sv.uploaded_by = (select auth.uid())))
  );
$$;

revoke execute on function private.can_upload_object(text) from public;
revoke execute on function private.can_read_object(text) from public;
grant execute on function private.can_upload_object(text) to authenticated;
grant execute on function private.can_read_object(text) to authenticated;

create policy project_files_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'project-files' and (select private.can_upload_object(name)));

create policy project_files_select on storage.objects
  for select to authenticated
  using (bucket_id = 'project-files' and (select private.can_read_object(name)));
-- No UPDATE or DELETE policies: stored originals cannot be overwritten or removed by users.
