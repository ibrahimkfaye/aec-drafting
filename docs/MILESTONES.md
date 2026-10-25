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
- ⬜ 1.4 Seed script: one SYNTHETIC firm with one user per role (local only).
- ⬜ 1.5 Sign-in / sign-out (Supabase Auth, `@supabase/ssr`), protected routes, server-side session checks.
- ⬜ 1.6 Project create / list / detail (server actions, schema validation, role checks, optimistic concurrency).
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
