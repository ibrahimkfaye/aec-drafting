-- =============================================================================
-- Migration 0007 — Evidence snapshots.
--
-- A snapshot freezes the project's approved evidence at one moment. Drafting
-- (Phase 3) will read ONLY from a locked snapshot.
--
--   evidence_snapshots        numbered per project (1, 2, …), locked by a reviewer/admin
--   evidence_snapshot_items   what went in, by exact immutable ids:
--       fact      a CURRENT, APPROVED fact revision (revisions and citations are immutable,
--                 so later edits or uploads can never change what a snapshot points at)
--       excluded  an approved fact left out, with the reason (open conflict / lost conflict)
--       gap       an OPEN gap, carried as "information needed"
--
-- Locking rules (founder decision D-20: reviewers and admins may lock):
--   * the lock must match the preview the reviewer saw (fingerprint check) — any
--     evidence change in between makes the lock fail as stale;
--   * at least one fact must be included;
--   * a snapshot identical to the previous one is refused;
--   * snapshots and their items can never be changed or deleted.
--
-- Consistency: every evidence write now takes a SHARE lock on its project row and
-- locking a snapshot takes an UPDATE lock, so a snapshot is never assembled while
-- evidence is mid-change. Evidence writes still run in parallel with each other.
-- =============================================================================

-- Evidence writers take a share lock on the project (was a plain read).
create or replace function private.writable_project(p_project_id uuid, p_roles public.member_role[])
returns public.projects
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v public.projects%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;
  select * into v from public.projects p where p.id = p_project_id for share;
  if not found or not private.has_org_role(v.org_id, p_roles) then
    raise exception 'project not found or not allowed' using errcode = 'insufficient_privilege';
  end if;
  if v.status <> 'active' then
    raise exception 'project is archived' using errcode = 'check_violation';
  end if;
  return v;
end;
$$;

create table public.evidence_snapshots (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null,
  project_id       uuid not null,
  snapshot_number  integer not null check (snapshot_number >= 1),
  locked_by        uuid not null references auth.users (id),
  locked_at        timestamptz not null default now(),
  note             text check (length(note) <= 2000),
  fact_count       integer not null check (fact_count >= 1),
  excluded_count   integer not null check (excluded_count >= 0),
  gap_count        integer not null check (gap_count >= 0),
  fingerprint      text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  foreign key (project_id, org_id) references public.projects (id, org_id),
  unique (project_id, snapshot_number),
  unique (id, org_id, project_id)
);

create table public.evidence_snapshot_items (
  snapshot_id       uuid not null,
  org_id            uuid not null,
  project_id        uuid not null,
  item_type         text not null check (item_type in ('fact', 'excluded', 'gap')),
  fact_id           uuid,
  fact_revision_id  uuid,
  gap_id            uuid,
  exclusion_reason  text check (exclusion_reason in ('open_conflict', 'lost_conflict')),
  foreign key (snapshot_id, org_id, project_id) references public.evidence_snapshots (id, org_id, project_id),
  foreign key (fact_id, org_id, project_id) references public.facts (id, org_id, project_id),
  foreign key (fact_revision_id, org_id, project_id) references public.fact_revisions (id, org_id, project_id),
  foreign key (gap_id) references public.gaps (id),
  check ((item_type in ('fact', 'excluded')) = (fact_revision_id is not null and fact_id is not null and gap_id is null)),
  check ((item_type = 'gap') = (gap_id is not null and fact_id is null and fact_revision_id is null)),
  check ((item_type = 'excluded') = (exclusion_reason is not null))
);
create unique index evidence_snapshot_items_fact_uniq on public.evidence_snapshot_items (snapshot_id, fact_id) where fact_id is not null;
create unique index evidence_snapshot_items_gap_uniq on public.evidence_snapshot_items (snapshot_id, gap_id) where gap_id is not null;

create trigger evidence_snapshots_append_only before update or delete on public.evidence_snapshots
  for each row execute function private.append_only();
create trigger evidence_snapshot_items_append_only before update or delete on public.evidence_snapshot_items
  for each row execute function private.append_only();
create trigger evidence_snapshots_no_truncate before truncate on public.evidence_snapshots
  for each statement execute function private.append_only();
create trigger evidence_snapshot_items_no_truncate before truncate on public.evidence_snapshot_items
  for each statement execute function private.append_only();

-- -----------------------------------------------------------------------------
-- What a snapshot of this project would contain right now.
-- -----------------------------------------------------------------------------
create function private.snapshot_candidate(p_project_id uuid)
returns table (item_type text, fact_id uuid, fact_revision_id uuid, gap_id uuid, exclusion_reason text)
language sql stable security definer set search_path = ''
as $$
  with current_rev as (
    select distinct on (r.fact_id) r.fact_id, r.id as revision_id, r.status
      from public.fact_revisions r
     where r.project_id = p_project_id
     order by r.fact_id, r.revision_number desc
  ),
  approved as (select * from current_rev where status = 'approved'),
  open_conflict as (
    select distinct cf.fact_id from public.conflict_facts cf
      join public.conflicts c on c.id = cf.conflict_id
     where c.project_id = p_project_id and c.status = 'open'
  ),
  lost_conflict as (
    select distinct cf.fact_id from public.conflict_facts cf
      join public.conflicts c on c.id = cf.conflict_id
     where c.project_id = p_project_id and c.status = 'resolved' and cf.fact_id <> c.prevailing_fact_id
  )
  select case when oc.fact_id is not null or lc.fact_id is not null then 'excluded' else 'fact' end,
         a.fact_id, a.revision_id, null::uuid,
         case when oc.fact_id is not null then 'open_conflict'
              when lc.fact_id is not null then 'lost_conflict' end
    from approved a
    left join open_conflict oc on oc.fact_id = a.fact_id
    left join lost_conflict lc on lc.fact_id = a.fact_id
  union all
  select 'gap', null, null, g.id, null from public.gaps g
   where g.project_id = p_project_id and g.status = 'open';
$$;

-- Order-independent fingerprint of a candidate (or of a locked snapshot's items).
create function private.items_fingerprint(p_items jsonb)
returns text
language sql immutable
as $$
  select encode(sha256(convert_to(coalesce(string_agg(line, E'\n' order by line), ''), 'UTF8')), 'hex')
    from (
      select concat_ws(':', i ->> 'item_type', i ->> 'fact_id', i ->> 'fact_revision_id',
                       i ->> 'gap_id', i ->> 'exclusion_reason') as line
        from jsonb_array_elements(p_items) i
    ) x;
$$;

-- Preview for the UI: the items plus the fingerprint a lock must match.
create function public.preview_evidence_snapshot(p_project_id uuid)
returns table (item_type text, fact_id uuid, fact_revision_id uuid, gap_id uuid, exclusion_reason text,
               fingerprint text, pending_review integer)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_org uuid;
  v_items jsonb;
  v_pending integer;
begin
  select p.org_id into v_org from public.projects p where p.id = p_project_id;
  if v_org is null or not private.is_org_member(v_org) then
    raise exception 'project not found or not allowed' using errcode = 'insufficient_privilege';
  end if;
  select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) into v_items from private.snapshot_candidate(p_project_id) c;
  select count(*) into v_pending from (
    select distinct on (r.fact_id) r.status from public.fact_revisions r
     where r.project_id = p_project_id order by r.fact_id, r.revision_number desc
  ) cur where cur.status = 'candidate';
  return query
    select c.item_type, c.fact_id, c.fact_revision_id, c.gap_id, c.exclusion_reason,
           private.items_fingerprint(v_items), v_pending
      from private.snapshot_candidate(p_project_id) c
    union all
    -- Always return one summary row so an empty project still reports its fingerprint.
    select 'summary', null, null, null, null, private.items_fingerprint(v_items), v_pending;
end;
$$;

create function public.lock_evidence_snapshot(p_project_id uuid, p_expected_fingerprint text, p_note text)
returns table (snapshot_id uuid, snapshot_number integer)
language plpgsql security definer set search_path = ''
as $$
declare
  v_project public.projects%rowtype;
  v_items jsonb;
  v_fp text;
  v_prev_fp text;
  v_number integer;
  v_id uuid;
  v_facts integer;
  v_excluded integer;
  v_gaps integer;
begin
  -- Take the exclusive lock FIRST (evidence writers hold FOR SHARE), so two
  -- simultaneous lockers queue instead of deadlocking on a lock upgrade.
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;
  select * into v_project from public.projects p where p.id = p_project_id for update;
  if not found or not private.has_org_role(v_project.org_id, array['admin', 'reviewer']::public.member_role[]) then
    raise exception 'project not found or not allowed' using errcode = 'insufficient_privilege';
  end if;
  if v_project.status <> 'active' then
    raise exception 'project is archived' using errcode = 'check_violation';
  end if;

  select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) into v_items from private.snapshot_candidate(v_project.id) c;
  v_fp := private.items_fingerprint(v_items);
  if v_fp is distinct from p_expected_fingerprint then
    raise exception 'stale: the evidence changed after you opened the preview' using errcode = 'check_violation';
  end if;

  select count(*) filter (where i ->> 'item_type' = 'fact'),
         count(*) filter (where i ->> 'item_type' = 'excluded'),
         count(*) filter (where i ->> 'item_type' = 'gap')
    into v_facts, v_excluded, v_gaps
    from jsonb_array_elements(v_items) i;
  if v_facts = 0 then
    raise exception 'a snapshot needs at least one approved fact' using errcode = 'check_violation';
  end if;

  select s.fingerprint, s.snapshot_number into v_prev_fp, v_number
    from public.evidence_snapshots s where s.project_id = v_project.id
   order by s.snapshot_number desc limit 1;
  if v_prev_fp = v_fp then
    raise exception 'identical to snapshot %; nothing has changed', v_number using errcode = 'check_violation';
  end if;
  v_number := coalesce(v_number, 0) + 1;

  insert into public.evidence_snapshots
    (org_id, project_id, snapshot_number, locked_by, note, fact_count, excluded_count, gap_count, fingerprint)
  values
    (v_project.org_id, v_project.id, v_number, auth.uid(), nullif(btrim(coalesce(p_note, '')), ''),
     v_facts, v_excluded, v_gaps, v_fp)
  returning id into v_id;

  insert into public.evidence_snapshot_items
    (snapshot_id, org_id, project_id, item_type, fact_id, fact_revision_id, gap_id, exclusion_reason)
  select v_id, v_project.org_id, v_project.id, i ->> 'item_type', (i ->> 'fact_id')::uuid,
         (i ->> 'fact_revision_id')::uuid, (i ->> 'gap_id')::uuid, i ->> 'exclusion_reason'
    from jsonb_array_elements(v_items) i;

  return query select v_id, v_number;
end;
$$;

revoke execute on function private.snapshot_candidate(uuid) from public;
revoke execute on function public.preview_evidence_snapshot(uuid) from public, anon;
revoke execute on function public.lock_evidence_snapshot(uuid, text, text) from public, anon;
grant execute on function public.preview_evidence_snapshot(uuid) to authenticated;
grant execute on function public.lock_evidence_snapshot(uuid, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Audit (counts and fingerprint only)
-- -----------------------------------------------------------------------------
create function private.evidence_snapshots_audit()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.write_audit(new.org_id, new.project_id, 'snapshot.locked', 'evidence_snapshot', new.id::text,
    jsonb_build_object('snapshot_number', new.snapshot_number, 'fact_count', new.fact_count,
                       'excluded_count', new.excluded_count, 'gap_count', new.gap_count,
                       'fingerprint', new.fingerprint));
  return null;
end;
$$;
create trigger evidence_snapshots_audit after insert on public.evidence_snapshots
  for each row execute function private.evidence_snapshots_audit();

-- -----------------------------------------------------------------------------
-- Row Level Security: read-only for firm members
-- -----------------------------------------------------------------------------
alter table public.evidence_snapshots enable row level security;
alter table public.evidence_snapshot_items enable row level security;
revoke all on public.evidence_snapshots, public.evidence_snapshot_items from anon, authenticated;
grant select on public.evidence_snapshots, public.evidence_snapshot_items to authenticated;
create policy evidence_snapshots_select on public.evidence_snapshots
  for select to authenticated using ((select private.is_org_member(org_id)));
create policy evidence_snapshot_items_select on public.evidence_snapshot_items
  for select to authenticated using ((select private.is_org_member(org_id)));
