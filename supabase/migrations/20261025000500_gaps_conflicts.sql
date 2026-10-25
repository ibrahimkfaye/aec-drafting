-- =============================================================================
-- Migration 0005 — Gaps (missing information) and conflicts between facts.
--
--   gaps              information the document needs but no approved fact provides.
--                     open -> resolved (by one exact APPROVED, CURRENT fact revision)
--                     open -> dismissed (with a written reason)
--   conflicts         two or more facts that disagree.
--                     open -> resolved (reviewer names the prevailing fact + note).
--                     Facts in an open conflict, and facts that lost a resolved
--                     conflict, will be excluded from evidence snapshots (1.9).
--   conflict_facts    the facts in a conflict (append-only).
--
-- Rules (same spirit as facts, decision D-13):
--   * admins, authors and reviewers may raise gaps and conflicts;
--   * only reviewers and admins may close them;
--   * the person who raised an item may not close it unless they are an admin,
--     in which case the closure is flagged self_closed;
--   * closed items are final (raise a new item instead); nothing is deleted.
-- Open gaps do not block drafting: they will appear in drafts as explicit
-- "information needed" markers, never as invented content.
-- =============================================================================

create type public.gap_status as enum ('open', 'resolved', 'dismissed');
create type public.conflict_status as enum ('open', 'resolved');

create table public.gaps (
  id                           uuid primary key default gen_random_uuid(),
  org_id                       uuid not null,
  project_id                   uuid not null,
  description                  text not null check (length(btrim(description)) between 1 and 1000),
  status                       public.gap_status not null default 'open',
  created_by                   uuid not null references auth.users (id),
  created_at                   timestamptz not null default now(),
  closed_by                    uuid references auth.users (id),
  closed_at                    timestamptz,
  closing_note                 text check (length(closing_note) <= 2000),
  resolving_fact_revision_id   uuid,
  self_closed                  boolean not null default false,
  foreign key (project_id, org_id) references public.projects (id, org_id),
  foreign key (resolving_fact_revision_id, org_id, project_id)
    references public.fact_revisions (id, org_id, project_id),
  check (status = 'open' or (closed_by is not null and closed_at is not null)),
  check (status <> 'open' or (closed_by is null and closed_at is null and resolving_fact_revision_id is null)),
  check (status <> 'resolved' or resolving_fact_revision_id is not null),
  check (status <> 'dismissed' or length(btrim(coalesce(closing_note, ''))) > 0)
);
create index gaps_project_idx on public.gaps (project_id, status, created_at);

create table public.conflicts (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null,
  project_id           uuid not null,
  description          text not null check (length(btrim(description)) between 1 and 1000),
  status               public.conflict_status not null default 'open',
  created_by           uuid not null references auth.users (id),
  created_at           timestamptz not null default now(),
  resolved_by          uuid references auth.users (id),
  resolved_at          timestamptz,
  resolution_note      text check (length(resolution_note) <= 2000),
  prevailing_fact_id   uuid,
  self_closed          boolean not null default false,
  foreign key (project_id, org_id) references public.projects (id, org_id),
  foreign key (prevailing_fact_id, org_id, project_id) references public.facts (id, org_id, project_id),
  unique (id, org_id, project_id),
  check (status = 'open' or (resolved_by is not null and resolved_at is not null
                             and prevailing_fact_id is not null
                             and length(btrim(coalesce(resolution_note, ''))) > 0)),
  check (status <> 'open' or (resolved_by is null and resolved_at is null and prevailing_fact_id is null))
);
create index conflicts_project_idx on public.conflicts (project_id, status, created_at);

create table public.conflict_facts (
  conflict_id  uuid not null,
  fact_id      uuid not null,
  org_id       uuid not null,
  project_id   uuid not null,
  primary key (conflict_id, fact_id),
  foreign key (conflict_id, org_id, project_id) references public.conflicts (id, org_id, project_id),
  foreign key (fact_id, org_id, project_id) references public.facts (id, org_id, project_id)
);
create index conflict_facts_fact_idx on public.conflict_facts (fact_id);

-- -----------------------------------------------------------------------------
-- Guards: open -> closed once; identity fields immutable; no deletes.
-- -----------------------------------------------------------------------------
create function private.close_once_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception '% cannot be deleted', tg_table_name using errcode = 'insufficient_privilege';
  end if;
  if new.id <> old.id or new.org_id <> old.org_id or new.project_id <> old.project_id
     or new.description <> old.description or new.created_by <> old.created_by
     or new.created_at <> old.created_at then
    raise exception '% identity fields are immutable', tg_table_name using errcode = 'check_violation';
  end if;
  if old.status::text <> 'open' then
    raise exception 'a closed % cannot be changed; raise a new one instead', tg_table_name using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger gaps_guard before update or delete on public.gaps
  for each row execute function private.close_once_guard();
create trigger conflicts_guard before update or delete on public.conflicts
  for each row execute function private.close_once_guard();
create trigger conflict_facts_append_only before update or delete on public.conflict_facts
  for each row execute function private.append_only();
create trigger gaps_no_truncate before truncate on public.gaps
  for each statement execute function private.append_only();
create trigger conflicts_no_truncate before truncate on public.conflicts
  for each statement execute function private.append_only();
create trigger conflict_facts_no_truncate before truncate on public.conflict_facts
  for each statement execute function private.append_only();

-- Shared check for closing an item.
create function private.assert_can_close(p_org uuid, p_created_by uuid)
returns boolean   -- returns self_closed flag
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_is_admin boolean := private.has_org_role(p_org, array['admin']::public.member_role[]);
begin
  if p_created_by = auth.uid() and not v_is_admin then
    raise exception 'separation of duties: you cannot close an item you raised' using errcode = 'insufficient_privilege';
  end if;
  return p_created_by = auth.uid();
end;
$$;
revoke execute on function private.assert_can_close(uuid, uuid) from public;

-- -----------------------------------------------------------------------------
-- Gaps
-- -----------------------------------------------------------------------------
create function public.create_gap(p_project_id uuid, p_description text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_project public.projects%rowtype;
  v_id uuid;
begin
  v_project := private.writable_project(p_project_id, array['admin', 'author', 'reviewer']::public.member_role[]);
  insert into public.gaps (org_id, project_id, description, created_by)
  values (v_project.org_id, v_project.id, btrim(p_description), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- p_decision: 'resolve' (needs p_fact_revision_id) or 'dismiss' (needs p_note).
create function public.close_gap(p_gap_id uuid, p_decision text, p_fact_revision_id uuid, p_note text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_gap public.gaps%rowtype;
  v_rev public.fact_revisions%rowtype;
  v_current integer;
  v_self boolean;
begin
  select * into v_gap from public.gaps g where g.id = p_gap_id for update;
  if not found then
    raise exception 'gap not found or not allowed' using errcode = 'insufficient_privilege';
  end if;
  perform private.writable_project(v_gap.project_id, array['admin', 'reviewer']::public.member_role[]);
  if v_gap.status <> 'open' then
    raise exception 'stale: this gap is already closed' using errcode = 'check_violation';
  end if;
  v_self := private.assert_can_close(v_gap.org_id, v_gap.created_by);

  if p_decision = 'resolve' then
    select * into v_rev from public.fact_revisions r
     where r.id = p_fact_revision_id and r.project_id = v_gap.project_id and r.org_id = v_gap.org_id;
    if not found then
      raise exception 'fact not found in this project' using errcode = 'check_violation';
    end if;
    perform 1 from public.facts f where f.id = v_rev.fact_id for share;   -- no new revision mid-check
    select max(r.revision_number) into v_current from public.fact_revisions r where r.fact_id = v_rev.fact_id;
    if v_rev.status <> 'approved' or v_rev.revision_number <> v_current then
      raise exception 'only a current, approved fact can resolve a gap' using errcode = 'check_violation';
    end if;
    update public.gaps
       set status = 'resolved', closed_by = auth.uid(), closed_at = now(),
           closing_note = nullif(btrim(coalesce(p_note, '')), ''),
           resolving_fact_revision_id = v_rev.id, self_closed = v_self
     where id = v_gap.id;
    return 'resolved';
  elsif p_decision = 'dismiss' then
    if length(btrim(coalesce(p_note, ''))) = 0 then
      raise exception 'dismissing a gap needs a note explaining why' using errcode = 'check_violation';
    end if;
    update public.gaps
       set status = 'dismissed', closed_by = auth.uid(), closed_at = now(),
           closing_note = btrim(p_note), self_closed = v_self
     where id = v_gap.id;
    return 'dismissed';
  end if;
  raise exception 'decision must be resolve or dismiss' using errcode = 'check_violation';
end;
$$;

-- -----------------------------------------------------------------------------
-- Conflicts
-- -----------------------------------------------------------------------------
create function public.create_conflict(p_project_id uuid, p_description text, p_fact_ids uuid[])
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_project public.projects%rowtype;
  v_id uuid;
  v_ids uuid[] := array(select distinct unnest(p_fact_ids));
  v_found integer;
begin
  v_project := private.writable_project(p_project_id, array['admin', 'author', 'reviewer']::public.member_role[]);
  if coalesce(array_length(v_ids, 1), 0) < 2 then
    raise exception 'a conflict needs at least two different facts' using errcode = 'check_violation';
  end if;
  if array_length(v_ids, 1) > 20 then
    raise exception 'at most 20 facts per conflict' using errcode = 'check_violation';
  end if;
  select count(*) into v_found from public.facts f
   where f.id = any (v_ids) and f.project_id = v_project.id and f.org_id = v_project.org_id;
  if v_found <> array_length(v_ids, 1) then
    raise exception 'fact not found in this project' using errcode = 'check_violation';
  end if;

  insert into public.conflicts (org_id, project_id, description, created_by)
  values (v_project.org_id, v_project.id, btrim(p_description), auth.uid())
  returning id into v_id;
  insert into public.conflict_facts (conflict_id, fact_id, org_id, project_id)
  select v_id, f, v_project.org_id, v_project.id from unnest(v_ids) f;
  return v_id;
end;
$$;

create function public.resolve_conflict(p_conflict_id uuid, p_prevailing_fact_id uuid, p_note text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_c public.conflicts%rowtype;
  v_self boolean;
begin
  select * into v_c from public.conflicts c where c.id = p_conflict_id for update;
  if not found then
    raise exception 'conflict not found or not allowed' using errcode = 'insufficient_privilege';
  end if;
  perform private.writable_project(v_c.project_id, array['admin', 'reviewer']::public.member_role[]);
  if v_c.status <> 'open' then
    raise exception 'stale: this conflict is already resolved' using errcode = 'check_violation';
  end if;
  v_self := private.assert_can_close(v_c.org_id, v_c.created_by);
  if not exists (select 1 from public.conflict_facts cf where cf.conflict_id = v_c.id and cf.fact_id = p_prevailing_fact_id) then
    raise exception 'the prevailing fact must be one of the conflicting facts' using errcode = 'check_violation';
  end if;
  if length(btrim(coalesce(p_note, ''))) = 0 then
    raise exception 'resolving a conflict needs a note explaining why' using errcode = 'check_violation';
  end if;
  update public.conflicts
     set status = 'resolved', resolved_by = auth.uid(), resolved_at = now(),
         resolution_note = btrim(p_note), prevailing_fact_id = p_prevailing_fact_id, self_closed = v_self
   where id = v_c.id;
  return 'resolved';
end;
$$;

revoke execute on function public.create_gap(uuid, text) from public, anon;
revoke execute on function public.close_gap(uuid, text, uuid, text) from public, anon;
revoke execute on function public.create_conflict(uuid, text, uuid[]) from public, anon;
revoke execute on function public.resolve_conflict(uuid, uuid, text) from public, anon;
grant execute on function public.create_gap(uuid, text) to authenticated;
grant execute on function public.close_gap(uuid, text, uuid, text) to authenticated;
grant execute on function public.create_conflict(uuid, text, uuid[]) to authenticated;
grant execute on function public.resolve_conflict(uuid, uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Audit (ids and flags only)
-- -----------------------------------------------------------------------------
create function private.gaps_conflicts_audit()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_kind text := case tg_table_name when 'gaps' then 'gap' else 'conflict' end;
  v_action text;
begin
  if tg_op = 'INSERT' then
    v_action := v_kind || '.created';
  else
    v_action := v_kind || '.' || new.status::text;   -- gap.resolved | gap.dismissed | conflict.resolved
  end if;
  perform private.write_audit(new.org_id, new.project_id, v_action, v_kind, new.id::text,
    jsonb_build_object('self_closed', new.self_closed));
  return null;
end;
$$;

create trigger gaps_audit after insert or update on public.gaps
  for each row execute function private.gaps_conflicts_audit();
create trigger conflicts_audit after insert or update on public.conflicts
  for each row execute function private.gaps_conflicts_audit();

-- -----------------------------------------------------------------------------
-- Row Level Security: read-only for firm members
-- -----------------------------------------------------------------------------
alter table public.gaps enable row level security;
alter table public.conflicts enable row level security;
alter table public.conflict_facts enable row level security;
revoke all on public.gaps, public.conflicts, public.conflict_facts from anon, authenticated;
grant select on public.gaps, public.conflicts, public.conflict_facts to authenticated;

create policy gaps_select on public.gaps
  for select to authenticated using ((select private.is_org_member(org_id)));
create policy conflicts_select on public.conflicts
  for select to authenticated using ((select private.is_org_member(org_id)));
create policy conflict_facts_select on public.conflict_facts
  for select to authenticated using ((select private.is_org_member(org_id)));
