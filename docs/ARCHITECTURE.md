# Architecture (pilot)

Status: **draft, Phase 1 in progress.** Only items marked ✅ in `MILESTONES.md` exist.

## What the system is

A written-document drafting assistant for one AEC firm and one document type. It
turns project inputs into a draft **only from evidence a human has approved**, and
requires a second human approval before any document is released. It is not a CAD
tool, not an engineering-design system, and does not guarantee factual accuracy or
replace professional judgment.

## Components

| Concern | Choice | Phase | Notes |
|---|---|---|---|
| Web app | Next.js 16 (App Router) + TypeScript | 1 | Server Actions / route handlers hold all business rules. |
| UI | Tailwind CSS 4 (+ shadcn/ui when first forms land) | 1 | |
| Database | Supabase Postgres | 1 | Single primary database. Row Level Security on every table. |
| Auth | Supabase Auth | 1 | Sessions via `@supabase/ssr` cookies. |
| Files | Supabase Storage, **private buckets only** | 1 | Short-lived signed URLs for download. |
| Background jobs | Trigger.dev | 2 | Idempotent, keyed by `(source_version_id, job_kind)`. |
| OCR / layout | Azure AI Document Intelligence (behind an adapter) | 2 | Mock adapter by default. |
| LLM | Anthropic API (behind an adapter) | 2–3 | Model IDs from server env vars; mock mode visible in UI. |
| DOCX | Docxtemplater (+ licensed image module if required) | 4 | |
| PDF | Gotenberg in a private container | 4 | |
| Tests | Vitest (unit + DB policy), Playwright (E2E) | 1+ | |
| Hosting | Vercel (web app only) | 5 | Nothing deployed yet. See "Deployment". |
| Background jobs | Trigger.dev (preview/production); local runner for dev only | 1.8c | Task code written; no Trigger.dev project yet. |
| PDF conversion | Gotenberg as a private, authenticated container | 4 | Called only from Trigger.dev tasks. Host not chosen. |

No vector database, no embeddings, no second primary database, no no-code platform.
Retrieval starts with SQL + Postgres full-text search.

## Trust boundaries

1. **Browser** — untrusted. Holds only the publishable Supabase key and the
   user's session. Every protected action is re-checked on the server.
2. **Next.js server** — calls Supabase *as the signed-in user*, so RLS applies
   as a second, independent check. The secret/service key is used only by
   operator scripts (seeding, membership management), never in request paths
   that act on user input.
3. **Postgres** — final authority: RLS policies, constraints, triggers, and
   (from milestone 1.8) `SECURITY DEFINER` functions for approvals that check
   versions atomically.
4. **External providers** — not contacted until deliberately configured *and*
   the user authorizes the specific material. Uploaded content is data, never
   instructions.

## Authorization model

Roles per firm: `admin`, `author`, `reviewer`, `viewer`.

| Action | admin | author | reviewer | viewer |
|---|---|---|---|---|
| Read firm projects, files, evidence, audit | ✅ | ✅ | ✅ | ✅ |
| Create / edit project | ✅ | ✅ | — | — |
| Upload sources, enter candidate facts (1.7) | ✅ | ✅ | — | — |
| Approve evidence / lock snapshot (1.8–1.9) | ✅ | — | ✅ | — |
| Final release (Phase 4) | ✅ | — | ✅ (assigned) | — |
| Change memberships/roles | operator only (service key, out-of-band) |

**AI never approves.** Approval functions require a human `auth.uid()` with an
approver role; background/AI jobs run with no user identity and are rejected.

Open question Q-04: should the author of a fact be blocked from approving it
(separation of duties)? Default proposal: yes for evidence approval.

## Status separation (planned)

- Evidence: `candidate → approved | rejected` per fact revision; snapshots are immutable.
- Draft: `generating → in_review → approved | stale`.
- Release: `pending → released` tied to an exact draft version hash.

Any change upstream (new fact revision, new snapshot) marks dependent draft
approvals `stale`; any draft edit after approval invalidates final release approval.

## Data ownership

Every row carries `org_id`. Child tables use composite foreign keys
`(project_id, org_id) → projects(id, org_id)` so a row can never reference a
project in another firm, even through a bug.

## File uploads (milestone 1.7)

Files never pass through the app server (Vercel limits request bodies to ~4.5 MB):

1. **Start** (server action): checks role, project is active, filename, extension and size.
   Unsupported/empty/oversized files are recorded as `blocked` and never uploaded.
   Otherwise `begin_source_upload()` creates a version row (`uploading`) with a storage
   path built only from IDs, and the server issues a one-time signed upload URL.
2. **Upload** (browser → Supabase Storage, private bucket `project-files`). Storage RLS
   allows the write only to that exact path, only by the uploader, only while `uploading`.
   No update/delete policies: originals cannot be overwritten or removed by users.
3. **Verify** (background job, since 1.8c): the server action records a `processing_jobs` row
   and hands it to the runner, returning the job id. The worker (service role) re-reads the
   stored bytes, checks size, file signature (PDF/PNG/JPEG) or UTF-8 text validity, computes
   SHA-256, then calls `worker_finish_upload()` → `stored` or `blocked`. Users cannot call the
   worker functions. Blocked bytes are unreadable. Failed jobs can be retried by the uploader.

Downloads go through `/projects/:id/files/:versionId`, which re-checks the user and
redirects to a signed URL valid for 60 seconds with `Content-Disposition: attachment`.

Known gaps: see ASSUMPTIONS.md S-01…S-04.

## Deployment (decided 2026-10-25; nothing provisioned yet)

Vercel hosts **only** the Next.js app. Its limits shape the design (Vercel docs, checked 2026-10-25):
request **and** response bodies are capped at **4.5 MB** per Function call; Function duration
is 300 s by default (800 s max on Pro); the **Hobby plan is for non-commercial personal use only**.

| Concern | Where it runs | Rule |
|---|---|---|
| Pages, server actions, authorization | Vercel Functions | Every check server-side; RLS as second layer. |
| File upload | Browser → Supabase Storage (signed one-time URL) | Bytes never pass through Vercel. |
| File download | Vercel Function checks access → 303 redirect to 60 s signed Storage URL | Bytes never pass through Vercel. |
| Content verification, OCR, extraction, drafting, DOCX assembly | Trigger.dev tasks | App records a `processing_jobs` row, hands off, returns the **job id**; UI polls status. |
| DOCX → PDF | Gotenberg (private container, basic auth, no public route) | Called only from Trigger.dev tasks, never from Vercel or browsers. |

### Credentials by location (privileged keys never reach browsers or Vercel)

| Secret | Local (.env.local) | Vercel (server env) | Trigger.dev (env vars) |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | ✅ | ✅ | — |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (service role) | ✅ local stack only | ❌ **refused at runtime** | ✅ |
| `TRIGGER_SECRET_KEY` | optional | ✅ (trigger-only key) | — |
| `ANTHROPIC_API_KEY`, `AZURE_DOCINTEL_KEY` (later) | mock by default | ❌ | ✅ |
| `GOTENBERG_URL` + basic-auth credentials (later) | local container | ❌ | ✅ |

`src/lib/server-env.ts` enforces: no local job runner on Vercel; no Supabase secret key on
Vercel; no Vercel deployment pointed at a local Supabase URL. Unit-tested.

### Environment separation (no shared data or credentials)

| | Development | Preview | Production |
|---|---|---|---|
| Web | `npm run dev` on your Mac | Vercel Preview deployments (protected with Vercel Authentication) | Vercel Production |
| Database/Storage/Auth | Local Supabase (Docker) | Separate **staging** Supabase project, SYNTHETIC data only | Separate **production** Supabase project |
| Jobs | Local runner (labeled in UI) | Trigger.dev **staging** environment | Trigger.dev **prod** environment |
| Email | Local test inbox | Staging SMTP sender | Production SMTP sender |
| AI / OCR | Mock adapters | Mock, or live only with explicit approval | Live after approval |

Migrations are applied to staging first, then production, never edited after applying.

### Paid/approval-required items (NOT provisioned — needs your decision)

1. **Vercel plan:** Hobby forbids commercial use, so a pilot with a paying firm needs Pro
   (currently $20 per developer seat/month per Vercel's docs; Pro trial available).
2. **Supabase staging + production projects:** plan, region, backup coverage to be confirmed at provisioning.
3. **Trigger.dev project:** plan and pricing to be confirmed at provisioning.
4. **Gotenberg host** (Phase 4): private container host to be chosen.
5. **Transactional email (SMTP)** for magic links (U-06).
6. **Malware scanning service** (U-04).

## Backups (to be completed in Phase 5)

Supabase database backups do **not** include Storage file objects. File backup
and a tested restore procedure must be designed separately before live data.
