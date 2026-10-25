-- =============================================================================
-- Migration 0004 — Facts, revisions, citations and human review.
--
--   facts           a logical fact within a project
--   fact_revisions  every wording of that fact; immutable history. The CURRENT
--                   revision is the one with the highest revision_number.
--   fact_citations  where a revision comes from: a STORED source version in the
--                   same project, a page and/or section, and a supporting excerpt.
--
-- Status of a revision: candidate -> approved | rejected; candidate/approved ->
-- superseded when someone edits the fact (an edit is always a new candidate, so
-- editing an approved fact removes it from the approved set until re-reviewed).
--
-- Review rules (enforced here, not just in the UI):
--   * only reviewers and admins may approve or reject;
--   * the person who wrote a revision may not approve it — unless they are an
--     admin, in which case the approval is flagged self_approved (founder
--     decision D-13);
--   * approval applies to one exact revision, which must still be current
--     (checked atomically under a row lock);
--   * a revision without at least one citation cannot be approved;
--   * rejection requires a note.
-- All writes go through the functions below; there is no direct write access.
-- =============================================================================

create type public.fact_status as enum ('candidate', 'approved', 'rejected', 'superseded');

-- Lets citations use a composite FK so they can only cite files in the same project.
alter table public.source_versions
  add constraint source_versions_id_org_project_key unique (id, org_id, project_id);

create table public.facts (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  project_id  uuid not null,
  created_by  uuid not null references auth.users (id),
  created_at  timestamptz not null default now(),
  foreign key (project_id, org_id) references public.projects (id, org_id),
  unique (id, org_id, project_id)
);
create index facts_project_idx on public.facts (project_id, created_at);

create table public.fact_revisions (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null,
  project_id       uuid not null,
  fact_id          uuid not null,
  revision_number  integer not null check (revision_number >= 1),
  statement        text not null check (length(btrim(statement)) between 1 and 2000),
  status           public.fact_status not null default 'candidate',
  origin           text not null default 'manual' check (origin in ('manual')),  -- 'extracted' arrives in Phase 2
  created_by       uuid not null references auth.users (id),
  created_at       timestamptz not null default now(),
  reviewed_by      uuid references auth.users (id),
  reviewed_at      timestamptz,
  review_note      text check (length(review_note) <= 2000),
  self_approved    boolean not null default false,
  foreign key (fact_id, org_id, project_id) references public.facts (id, org_id, project_id),
  unique (fact_id, revision_number),
  unique (id, org_id, project_id),
  check (status not in ('approved', 'rejected') or (reviewed_by is not null and reviewed_at is not null)),
  check (status <> 'rejected' or length(btrim(coalesce(review_note, ''))) > 0),
  check (status <> 'candidate' or (reviewed_by is null and reviewed_at is null)),
  check (not self_approved or (status in ('approved', 'superseded') and reviewed_by = created_by))
);
create index fact_revisions_fact_idx on public.fact_revisions (fact_id, revision_number desc);

create table public.fact_citations (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null,
  project_id         uuid not null,
  fact_revision_id   uuid not null,
  source_version_id  uuid not null,
  page               integer check (page >= 1 and page <= 100000),
  section            text check (length(section) <= 200),
  excerpt            text not null check (length(btrim(excerpt)) between 1 and 2000),
  created_at         timestamptz not null default now(),
  foreign key (fact_revision_id, org_id, project_id) references public.fact_revisions (id, org_id, project_id),
  foreign key (source_version_id, org_id, project_id) references public.source_versions (id, org_id, project_id),
  check (page is not null or length(btrim(coalesce(section, ''))) > 0)
);
create index fact_citations_revision_idx on public.fact_citations (fact_revision_id);

-- -----------------------------------------------------------------------------
-- Immutability guards (apply to everyone, including the database owner)
-- -----------------------------------------------------------------------------
create function private.fact_revisions_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'fact history cannot be deleted' using errcode = 'insufficient_privilege';
  end if;
  if new.id <> old.id or new.org_id <> old.org_id or new.project_id <> old.project_id
     or new.fact_id <> old.fact_id or new.revision_number <> old.revision_number
     or new.statement <> old.statement or new.origin <> old.origin
     or new.created_by <> old.created_by or new.created_at <> old.created_at then
    raise exception 'fact revisions are immutable; create a new revision instead' using errcode = 'check_violation';
  end if;
  if not (
       (old.status = 'candidate' and new.status in ('approved', 'rejected'))
    or (old.status in ('candidate', 'approved') and new.status = 'superseded'
        and new.reviewed_by is not distinct from old.reviewed_by
        and new.reviewed_at is not distinct from old.reviewed_at
        and new.review_note is not distinct from old.review_note
        and new.self_approved = old.self_approved)
  ) then
    raise exception 'invalid fact status change: % -> %', old.status, new.status using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger fact_revisions_guard
  before update or delete on public.fact_revisions
  for each row execute function private.fact_revisions_guard();

create function private.append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = 'insufficient_privilege';
end;
$$;

create trigger fact_citations_append_only
  before update or delete on public.fact_citations
  for each row execute function private.append_only();
create trigger facts_append_only
  before update or delete on public.facts
  for each row execute function private.append_only();
create trigger facts_no_truncate before truncate on public.facts
  for each statement execute function private.append_only();
create trigger fact_revisions_no_truncate before truncate on public.fact_revisions
  for each statement execute function private.append_only();
create trigger fact_citations_no_truncate before truncate on public.fact_citations
  for each statement execute function private.append_only();

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

-- Returns the project if the caller has one of p_roles in its firm and it is active.
create function private.writable_project(p_project_id uuid, p_roles public.member_role[])
returns public.projects
language plpgsql stable security definer set search_path = ''
as $$
declare
  v public.projects%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;
  select * into v from public.projects p where p.id = p_project_id;
  if not found or not private.has_org_role(v.org_id, p_roles) then
    raise exception 'project not found or not allowed' using errcode = 'insufficient_privilege';
  end if;
  if v.status <> 'active' then
    raise exception 'project is archived' using errcode = 'check_violation';
  end if;
  return v;
end;
$$;

-- Validates and inserts citations for a revision. p_citations is a JSON array of
-- {source_version_id, page?, section?, excerpt}.
create function private.add_citations(p_revision public.fact_revisions, p_citations jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  c jsonb;
  v_sv public.source_versions%rowtype;
begin
  if p_citations is null or jsonb_typeof(p_citations) <> 'array' then
    raise exception 'citations must be a list' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(p_citations) > 10 then
    raise exception 'at most 10 citations per revision' using errcode = 'check_violation';
  end if;
  for c in select * from jsonb_array_elements(p_citations) loop
    select * into v_sv from public.source_versions sv
     where sv.id = (c ->> 'source_version_id')::uuid
       and sv.project_id = p_revision.project_id and sv.org_id = p_revision.org_id;
    if not found then
      raise exception 'cited file not found in this project' using errcode = 'check_violation';
    end if;
    if v_sv.status <> 'stored' then
      raise exception 'only stored files can be cited' using errcode = 'check_violation';
    end if;
    insert into public.fact_citations (org_id, project_id, fact_revision_id, source_version_id, page, section, excerpt)
    values (p_revision.org_id, p_revision.project_id, p_revision.id, v_sv.id,
            nullif(c ->> 'page', '')::integer, nullif(btrim(c ->> 'section'), ''), c ->> 'excerpt');
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Public functions (called by the app as the signed-in user)
-- -----------------------------------------------------------------------------
create function public.create_fact(p_project_id uuid, p_statement text, p_citations jsonb)
returns table (fact_id uuid, revision_id uuid)
language plpgsql security definer set search_path = ''
as $$
declare
  v_project public.projects%rowtype;
  v_fact uuid;
  v_rev public.fact_revisions%rowtype;
begin
  v_project := private.writable_project(p_project_id, array['admin', 'author', 'reviewer']::public.member_role[]);
  insert into public.facts (org_id, project_id, created_by)
  values (v_project.org_id, v_project.id, auth.uid())
  returning id into v_fact;
  insert into public.fact_revisions (org_id, project_id, fact_id, revision_number, statement, created_by)
  values (v_project.org_id, v_project.id, v_fact, 1, btrim(p_statement), auth.uid())
  returning * into v_rev;
  perform private.add_citations(v_rev, p_citations);
  return query select v_fact, v_rev.id;
end;
$$;

-- Edit = new candidate revision. p_based_on_revision_id must be the current
-- revision, so two people editing at once cannot silently overwrite each other.
create function public.revise_fact(
  p_fact_id uuid, p_based_on_revision_id uuid, p_statement text, p_citations jsonb
) returns table (revision_id uuid, revision_number integer)
language plpgsql security definer set search_path = ''
as $$
declare
  v_fact public.facts%rowtype;
  v_current public.fact_revisions%rowtype;
  v_rev public.fact_revisions%rowtype;
begin
  select * into v_fact from public.facts f where f.id = p_fact_id for update;
  if not found then
    raise exception 'fact not found or not allowed' using errcode = 'insufficient_privilege';
  end if;
  perform private.writable_project(v_fact.project_id, array['admin', 'author', 'reviewer']::public.member_role[]);

  select * into v_current from public.fact_revisions r
   where r.fact_id = v_fact.id order by r.revision_number desc limit 1;
  if v_current.id <> p_based_on_revision_id then
    raise exception 'stale: this fact changed after you opened it' using errcode = 'check_violation';
  end if;

  if v_current.status in ('candidate', 'approved') then
    update public.fact_revisions set status = 'superseded' where id = v_current.id;
  end if;
  insert into public.fact_revisions (org_id, project_id, fact_id, revision_number, statement, created_by)
  values (v_fact.org_id, v_fact.project_id, v_fact.id, v_current.revision_number + 1, btrim(p_statement), auth.uid())
  returning * into v_rev;
  perform private.add_citations(v_rev, p_citations);
  return query select v_rev.id, v_rev.revision_number;
end;
$$;

create function public.review_fact_revision(p_revision_id uuid, p_decision text, p_note text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_rev public.fact_revisions%rowtype;
  v_current_number integer;
  v_is_admin boolean;
begin
  if p_decision not in ('approve', 'reject') then
    raise exception 'decision must be approve or reject' using errcode = 'check_violation';
  end if;
  select * into v_rev from public.fact_revisions r where r.id = p_revision_id;
  if not found then
    raise exception 'fact not found or not allowed' using errcode = 'insufficient_privilege';
  end if;
  perform private.writable_project(v_rev.project_id, array['admin', 'reviewer']::public.member_role[]);
  -- Lock the fact so no new revision can appear between our check and our write.
  perform 1 from public.facts f where f.id = v_rev.fact_id for update;
  select max(r.revision_number) into v_current_number from public.fact_revisions r where r.fact_id = v_rev.fact_id;
  select * into v_rev from public.fact_revisions r where r.id = p_revision_id;  -- re-read under lock

  if v_rev.revision_number <> v_current_number or v_rev.status <> 'candidate' then
    raise exception 'stale: this revision is no longer awaiting review' using errcode = 'check_violation';
  end if;

  v_is_admin := private.has_org_role(v_rev.org_id, array['admin']::public.member_role[]);
  if v_rev.created_by = v_uid and not v_is_admin then
    raise exception 'separation of duties: you cannot review a fact revision you wrote' using errcode = 'insufficient_privilege';
  end if;

  if p_decision = 'approve' then
    if not exists (select 1 from public.fact_citations c where c.fact_revision_id = v_rev.id) then
      raise exception 'a fact without a cited source cannot be approved' using errcode = 'check_violation';
    end if;
    update public.fact_revisions
       set status = 'approved', reviewed_by = v_uid, reviewed_at = now(),
           review_note = nullif(btrim(coalesce(p_note, '')), ''), self_approved = (v_rev.created_by = v_uid)
     where id = v_rev.id;
    return 'approved';
  end if;

  if length(btrim(coalesce(p_note, ''))) = 0 then
    raise exception 'a rejection needs a note explaining why' using errcode = 'check_violation';
  end if;
  update public.fact_revisions
     set status = 'rejected', reviewed_by = v_uid, reviewed_at = now(), review_note = btrim(p_note)
   where id = v_rev.id;
  return 'rejected';
end;
$$;

revoke execute on function public.create_fact(uuid, text, jsonb) from public, anon;
revoke execute on function public.revise_fact(uuid, uuid, text, jsonb) from public, anon;
revoke execute on function public.review_fact_revision(uuid, text, text) from public, anon;
grant execute on function public.create_fact(uuid, text, jsonb) to authenticated;
grant execute on function public.revise_fact(uuid, uuid, text, jsonb) to authenticated;
grant execute on function public.review_fact_revision(uuid, text, text) to authenticated;
revoke execute on function private.writable_project(uuid, public.member_role[]) from public;
revoke execute on function private.add_citations(public.fact_revisions, jsonb) from public;

-- -----------------------------------------------------------------------------
-- Audit (ids, numbers and flags only — never statement or excerpt text)
-- -----------------------------------------------------------------------------
create function private.fact_revisions_audit()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_action text;
begin
  if tg_op = 'INSERT' then
    v_action := case when new.revision_number = 1 then 'fact.created' else 'fact.revised' end;
  elsif new.status in ('approved', 'rejected') and old.status = 'candidate' then
    v_action := 'fact.' || new.status::text;
  else
    return null;  -- 'superseded' is implied by the following fact.revised event
  end if;
  perform private.write_audit(new.org_id, new.project_id, v_action, 'fact', new.fact_id::text,
    jsonb_build_object('revision_id', new.id, 'revision_number', new.revision_number,
                       'self_approved', new.self_approved));
  return null;
end;
$$;

create trigger fact_revisions_audit
  after insert or update on public.fact_revisions
  for each row execute function private.fact_revisions_audit();

-- -----------------------------------------------------------------------------
-- Row Level Security: read-only for firm members
-- -----------------------------------------------------------------------------
alter table public.facts enable row level security;
alter table public.fact_revisions enable row level security;
alter table public.fact_citations enable row level security;
revoke all on public.facts, public.fact_revisions, public.fact_citations from anon, authenticated;
grant select on public.facts, public.fact_revisions, public.fact_citations to authenticated;

create policy facts_select on public.facts
  for select to authenticated using ((select private.is_org_member(org_id)));
create policy fact_revisions_select on public.fact_revisions
  for select to authenticated using ((select private.is_org_member(org_id)));
create policy fact_citations_select on public.fact_citations
  for select to authenticated using ((select private.is_org_member(org_id)));
