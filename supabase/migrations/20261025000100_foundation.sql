-- =============================================================================
-- Migration 0001 — Foundation: organizations, memberships, projects, audit.
--
-- Security model (summary — see docs/ARCHITECTURE.md):
--   * Every table has Row Level Security (RLS) enabled.
--   * Signed-in users ("authenticated") can only see rows in firms they belong to.
--   * Memberships/roles have NO client write path. They are managed only by
--     an operator using the service role (seed script / admin tooling).
--     This is what keeps AI features and browser code from changing permissions.
--   * Audit events are append-only (UPDATE/DELETE/TRUNCATE are rejected by
--     triggers, which also apply to the service role).
--   * Projects are never hard-deleted by clients; they are archived.
-- =============================================================================

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Types
-- -----------------------------------------------------------------------------
create type public.member_role as enum ('admin', 'author', 'reviewer', 'viewer');
create type public.project_status as enum ('active', 'archived');

-- -----------------------------------------------------------------------------
-- Organizations (firms)
-- -----------------------------------------------------------------------------
create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 1 and 200),
  created_at  timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Memberships (user <-> firm, with role)
-- -----------------------------------------------------------------------------
create table public.memberships (
  org_id      uuid not null references public.organizations (id) on delete restrict,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        public.member_role not null,
  created_at  timestamptz not null default now(),
  primary key (org_id, user_id)
);

-- PILOT CONSTRAINT: each user belongs to exactly one firm.
-- Drop this index (in a new migration) when multi-firm membership is needed.
create unique index memberships_single_firm_pilot on public.memberships (user_id);

-- -----------------------------------------------------------------------------
-- Authorization helpers.
-- SECURITY DEFINER so policies can read memberships without recursive RLS.
-- search_path is pinned to '' to prevent search-path hijacking.
-- -----------------------------------------------------------------------------
create function private.has_org_role(p_org uuid, p_roles public.member_role[])
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org
      and m.user_id = (select auth.uid())
      and m.role = any (p_roles)
  );
$$;

create function private.is_org_member(p_org uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = (select auth.uid())
  );
$$;

revoke execute on function private.has_org_role(uuid, public.member_role[]) from public;
revoke execute on function private.is_org_member(uuid) from public;
grant execute on function private.has_org_role(uuid, public.member_role[]) to authenticated, service_role;
grant execute on function private.is_org_member(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Projects
-- -----------------------------------------------------------------------------
create table public.projects (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations (id) on delete restrict,
  name                  text not null check (length(btrim(name)) between 1 and 200),
  client_name           text not null check (length(btrim(client_name)) between 1 and 200),
  location              text not null check (length(btrim(location)) between 1 and 500),
  -- Free-text key for now; becomes a FK to a document_types table when the
  -- firm's first document type is confirmed (see docs/ASSUMPTIONS.md A-03).
  document_type         text not null check (length(btrim(document_type)) between 1 and 100),
  scope_instructions    text not null default '' check (length(scope_instructions) <= 20000),
  assigned_reviewer_id  uuid,
  status                public.project_status not null default 'active',
  created_by            uuid not null default auth.uid() references auth.users (id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  -- Optimistic-concurrency counter. Incremented by trigger on every update.
  row_version           integer not null default 1,
  -- Lets child tables use composite FKs (project_id, org_id) so a child row can
  -- never point at a project in a different firm.
  unique (id, org_id),
  -- Reviewer must be a member of the SAME firm (role is checked by trigger).
  foreign key (org_id, assigned_reviewer_id)
    references public.memberships (org_id, user_id)
    on delete set null (assigned_reviewer_id)
);

create index projects_org_idx on public.projects (org_id, status, created_at desc);

-- Guard immutable columns, enforce reviewer role, bump version/timestamps.
create function private.projects_before_write()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.org_id is distinct from old.org_id
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at
       or new.id is distinct from old.id then
      raise exception 'immutable project column changed'
        using errcode = 'check_violation';
    end if;
    new.row_version := old.row_version + 1;
    new.updated_at := now();
  else
    new.row_version := 1;
    new.created_at := now();
    new.updated_at := new.created_at;
  end if;

  if new.assigned_reviewer_id is not null and not exists (
    select 1 from public.memberships m
    where m.org_id = new.org_id
      and m.user_id = new.assigned_reviewer_id
      and m.role in ('reviewer', 'admin')
  ) then
    raise exception 'assigned reviewer must have reviewer or admin role in this firm'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger projects_before_write
  before insert or update on public.projects
  for each row execute function private.projects_before_write();

-- -----------------------------------------------------------------------------
-- Audit events (append-only)
-- `details` must hold metadata only (e.g. changed column NAMES), never document
-- content, so the audit log does not become a second copy of confidential data.
-- -----------------------------------------------------------------------------
create table public.audit_events (
  id           bigint generated always as identity primary key,
  org_id       uuid not null references public.organizations (id) on delete restrict,
  project_id   uuid,
  actor_id     uuid,          -- null when actor_type = 'system'
  actor_type   text not null check (actor_type in ('user', 'system')),
  action       text not null check (length(action) between 1 and 100),
  entity_type  text not null check (length(entity_type) between 1 and 100),
  entity_id    text not null,
  details      jsonb not null default '{}'::jsonb,
  occurred_at  timestamptz not null default now(),
  foreign key (project_id, org_id) references public.projects (id, org_id),
  check ((actor_type = 'user') = (actor_id is not null))
);

create index audit_events_org_idx on public.audit_events (org_id, occurred_at desc);
create index audit_events_project_idx on public.audit_events (project_id, occurred_at desc);

create function private.audit_events_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_events is append-only' using errcode = 'insufficient_privilege';
end;
$$;

create trigger audit_events_no_update_delete
  before update or delete on public.audit_events
  for each row execute function private.audit_events_immutable();

create trigger audit_events_no_truncate
  before truncate on public.audit_events
  for each statement execute function private.audit_events_immutable();

-- Internal writer used by triggers / server functions. Not callable by clients.
create function private.write_audit(
  p_org uuid, p_project uuid, p_action text,
  p_entity_type text, p_entity_id text, p_details jsonb
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  insert into public.audit_events
    (org_id, project_id, actor_id, actor_type, action, entity_type, entity_id, details)
  values
    (p_org, p_project, v_actor,
     case when v_actor is null then 'system' else 'user' end,
     p_action, p_entity_type, p_entity_id, coalesce(p_details, '{}'::jsonb));
end;
$$;
revoke execute on function private.write_audit(uuid, uuid, text, text, text, jsonb) from public;

-- Audit every project insert/update, recording which columns changed (names only).
create function private.projects_audit()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_changed text[];
begin
  if tg_op = 'INSERT' then
    perform private.write_audit(new.org_id, new.id, 'project.created', 'project', new.id::text,
      jsonb_build_object('row_version', new.row_version));
  else
    select coalesce(array_agg(n.key order by n.key), '{}')
      into v_changed
      from jsonb_each(to_jsonb(new)) n
      join jsonb_each(to_jsonb(old)) o using (key)
     where n.value is distinct from o.value
       and n.key not in ('updated_at', 'row_version');

    perform private.write_audit(new.org_id, new.id,
      case when new.status is distinct from old.status
           then 'project.status_changed' else 'project.updated' end,
      'project', new.id::text,
      jsonb_build_object('changed_fields', v_changed, 'row_version', new.row_version));
  end if;
  return null;
end;
$$;

create trigger projects_audit
  after insert or update on public.projects
  for each row execute function private.projects_audit();

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.organizations enable row level security;
alter table public.memberships   enable row level security;
alter table public.projects      enable row level security;
alter table public.audit_events  enable row level security;

-- Start from zero privileges, then grant exactly what is needed.
revoke all on public.organizations, public.memberships, public.projects, public.audit_events
  from anon, authenticated;

grant select on public.organizations to authenticated;
grant select on public.memberships to authenticated;
grant select, insert, update on public.projects to authenticated;   -- no DELETE
grant select on public.audit_events to authenticated;               -- no direct INSERT

create policy organizations_select on public.organizations
  for select to authenticated
  using ((select private.is_org_member(id)));

create policy memberships_select on public.memberships
  for select to authenticated
  using ((select private.is_org_member(org_id)));
-- (No insert/update/delete policies on memberships: operator-only via service role.)

create policy projects_select on public.projects
  for select to authenticated
  using ((select private.is_org_member(org_id)));

create policy projects_insert on public.projects
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (select private.has_org_role(org_id, array['admin', 'author']::public.member_role[]))
  );

create policy projects_update on public.projects
  for update to authenticated
  using ((select private.has_org_role(org_id, array['admin', 'author']::public.member_role[])))
  with check ((select private.has_org_role(org_id, array['admin', 'author']::public.member_role[])));

create policy audit_events_select on public.audit_events
  for select to authenticated
  using ((select private.is_org_member(org_id)));
