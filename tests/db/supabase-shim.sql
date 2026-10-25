-- =============================================================================
-- TEST-ONLY SHIM. NOT A MIGRATION. NEVER APPLY TO A REAL SUPABASE PROJECT.
--
-- Recreates the minimum of Supabase's built-in pieces (auth.users, auth.uid(),
-- and the anon/authenticated/service_role roles) on a plain PostgreSQL server
-- so RLS policies can be tested quickly without Docker.
--
-- auth.uid() mirrors Supabase's implementation: it reads the `sub` claim that
-- PostgREST places in the `request.jwt.claim.sub` / `request.jwt.claims`
-- settings. Results must still be re-verified against a real Supabase stack
-- (`supabase start` + `supabase test db`) before relying on them — tracked in
-- docs/MILESTONES.md.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

create table if not exists auth.users (
  id    uuid primary key,
  email text unique
);

create or replace function auth.uid() returns uuid
language sql stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- Supabase grants table privileges to these roles by default; reproduce that so
-- the migration's explicit REVOKE/GRANT statements are actually exercised.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
