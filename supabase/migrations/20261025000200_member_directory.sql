-- =============================================================================
-- Migration 0002 — Member directory.
--
-- Adds a display name and contact email to each membership so the app can show
-- people (reviewer picker, audit trail) without reading Supabase's private
-- auth.users table. Like roles, these are operator-managed: signed-in users can
-- read them for their own firm but have no write path (no grants were added).
-- =============================================================================

alter table public.memberships
  add column display_name text not null default ''
    check (length(display_name) <= 200),
  add column email text not null default ''
    check (length(email) <= 254);
