# Milestones

✅ done and verified · 🟡 done but needs verification on your machine · ⬜ not started

## Phase 0 — Inspect and plan
- ✅ 0.1 Inspected environment (blank project). Architecture, milestones, assumptions written.

## Phase 1 — Working non-AI foundation
- ✅ 1.1 Next.js + TypeScript + Tailwind + Vitest scaffold; typecheck, lint, build pass.
- ✅ 1.2 Migration 0001: organizations, memberships, projects, audit events, RLS.
  21 policy tests pass on plain PostgreSQL 16 + shim AND on real local Supabase (founder's Mac, 2026-10-24).
- ✅ 1.3 Local Supabase running on founder's Mac (CLI 2.122.0 pinned; realtime, vector storage,
  edge functions, analytics disabled). `npm run test:db:supabase`: 21/21 passed (run by founder).
- ✅ 1.4 `npm run env:local` (writes .env.local from local Supabase) and `npm run seed:local`
  (SYNTHETIC firm, one user per role + one user with no firm). Verified on founder's Mac.
- ✅ 1.5 Magic-link sign-in (sign-ups disabled, same response for unknown emails, 15-min single-use
  links, explicit "Continue signing in" button so email scanners can't consume links), sign-out,
  `proxy.ts` session refresh + redirect, server-side `requireUser`/`requireMembership` on every page.
  Verified: typecheck, lint, build, 23 unit tests, no secret key in browser bundle (Claude's workspace);
  7/7 Playwright E2E tests on founder's Mac against real local Supabase (2026-10-24).
- ✅ 1.6 Projects: list (dashboard), create, detail with history, edit, archive/restore.
  Migration 0002 adds operator-managed member display name/email. Server-side role checks (admin/author)
  + RLS; zod validation; configurable document types (placeholder only); reviewer must be firm reviewer/admin;
  optimistic concurrency (stale saves refused, typed input kept). Seed adds a second SYNTHETIC firm.
  Verified: typecheck, lint, build, 37 unit + 24 DB tests (Claude's workspace; incl. simultaneous-save test);
  24/24 DB tests and 13/13 E2E tests on founder's Mac against real local Supabase (2026-10-25).
  E2E now fails on any Next.js dev-overlay warning.
- ⬜ 1.7 Migration 0002: sources + source versions, private bucket + storage policies;
  upload validation (size, extension, MIME, file signature); unsupported/unsafe files
  recorded as `blocked`; malware scan status `not_scanned` until an integration is chosen.
- ⬜ 1.8 Migration 0003: facts + fact revisions with source location/excerpt, manual gaps and
  conflicts, approve/edit/reject by reviewer (atomic version check).
- ⬜ 1.9 Migration 0004: immutable evidence snapshots + items; new uploads/edits cannot alter a locked snapshot.
- ⬜ 1.10 Audit trail page; Playwright end-to-end smoke test of the whole Phase 1 flow.
- ⬜ 1.11 Phase 1 report.

## Phases 2–5
See the product brief. Not started.
