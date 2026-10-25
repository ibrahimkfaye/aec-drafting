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
  13/13 E2E tests on founder's Mac against real local Supabase (2026-10-25). DB tests on Mac: result not yet reported.
  E2E now fails on any Next.js dev-overlay warning.
- ✅ 1.7 Migration 0003: sources + immutable source versions, private bucket + storage policies;
  3-step upload (server pre-check → direct signed upload → server re-checks stored bytes);
  extension/size/signature/UTF-8 checks, SHA-256; blocked files recorded with reasons;
  `not_scanned` shown until a scanner exists; 60-second download links (attachment only).
  Verified here: 41 DB tests (incl. storage policies on shim, mutation-checked), 63 unit tests,
  typecheck, lint, build. Founder's Mac (2026-10-25): DB tests and 18/18 E2E tests reported passing.
- ✅ 1.8a Migration 0004: facts, immutable revisions, citations (stored file in same project + page/section
  + excerpt). Evidence review page: propose (admin/author/reviewer), approve/reject (reviewer/admin),
  edit = new candidate revision. Writer cannot review own revision unless admin (flagged self-approved).
  Approval bound to the exact current revision under a row lock; no approval without a citation;
  rejection needs a note. Verified here: 63 DB tests (mutation-checked), 78 unit tests, build.
  Founder's Mac (2026-10-25): 24/24 E2E tests passed. DB tests on Mac: result not yet reported.
- ✅ 1.8b Migration 0005: gaps (open → resolved by a current approved fact revision | dismissed with note)
  and conflicts (≥2 facts → resolved by naming the prevailing fact + note). Raise: admin/author/reviewer;
  close: reviewer/admin; raiser cannot close own item unless admin (flagged). Closed items final.
  Facts in open conflicts / non-prevailing facts flagged as excluded from snapshots. Forms keep input on refusal.
  Verified here: 76 DB tests (mutation-checked), 84 unit tests, build. Founder's Mac: all DB + E2E tests passed.
- ✅ 1.8c Background-job alignment. Migration 0006: `processing_jobs`; upload verification moved out of the
  web request into a background job (local runner for dev, Trigger.dev task for preview/prod);
  job id + live status in the upload UI; Retry for failed jobs; user-callable completion removed (S-02 closed);
  deployment rules enforced in code (no local runner / no service key / no local DB on Vercel).
  Verified here: 79 DB tests (mutation-checked), 93 unit tests, build, no secrets in browser bundle.
  Founder's Mac (2026-10-25): all DB + 28/28 E2E tests passed (local runner). Trigger.dev task NOT yet run (no project).
  Hosting decision (Vercel) DEFERRED by founder 2026-10-25; work continues local-first.
- ✅ 1.9 Migration 0007: evidence snapshots. Preview (current approved facts, open gaps, approved-but-excluded
  facts with reason, pending count) → lock by reviewer/admin, matched to the previewed fingerprint (stale = refused).
  Numbered, immutable, items reference immutable revision ids. Evidence writes take a project share lock;
  locking takes an exclusive lock (no interleaving, no deadlock). Empty/identical snapshots refused.
  Verified here: 95 DB tests (mutation-checked), 93 unit tests, build. Founder's Mac: all DB + 33/33 E2E tests passed.
- ⬜ 1.10 Audit trail page; Playwright end-to-end smoke test of the whole Phase 1 flow.
- ⬜ 1.11 Phase 1 report.

## Phases 2–5
See the product brief. Not started.
