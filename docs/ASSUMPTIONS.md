# Assumptions, decisions and open questions

Update this file whenever an assumption is confirmed or changed.

## Assumptions
| ID | Assumption | Status |
|---|---|---|
| A-01 | Development machine: Mac (Apple Silicon), Docker Desktop installed. | Confirmed by founder |
| A-02 | No Supabase cloud project yet; build against local Supabase first. | Confirmed |
| A-03 | First document type is **TBD**. Development uses a clearly labeled *sample technical memorandum* (`sample_technical_memo`). This is not confirmed commercial scope. | Placeholder |
| A-04 | Pilot = one firm; each user belongs to exactly one firm (enforced by `memberships_single_firm_pilot`, removable later). | Proposed |
| A-05 | Memberships/roles are managed by an operator with the service key, not through the app UI, during the pilot. | Proposed |
| A-06 | Projects are archived, never hard-deleted, by users. | Proposed |
| A-07 | Audit events store metadata (changed field names, versions), not document content. | Proposed |
| A-09 | Timestamps shown in UTC for now (unambiguous across offices); local time zone display later. | Proposed |
| A-08 | Node.js 22 LTS on all machines (`.nvmrc`). | Proposed |

## Decisions
| ID | Decision | Why |
|---|---|---|
| D-01 | DB policy tests run on plain PostgreSQL with a test-only shim (`tests/db/supabase-shim.sql`), plus later on a real Supabase stack. | Fast feedback without Docker; the shim is never applied to a real project. |
| D-02 | Removed Google-hosted fonts from the scaffold; system font stack. | Avoids a build-time external network dependency. |
| D-04 | Supabase CLI installed per-project via npm (`npx supabase`), not globally. | Everyone uses the same pinned version. |
| D-05 | Unused local Supabase services disabled in `config.toml`. | Lower memory/disk use on a laptop; re-enable if needed. |
| D-06 | Sign-in by magic link (founder's choice). Self sign-up disabled via `[auth] enable_signup = false` + `shouldCreateUser: false`; operator creates users. `[auth.email] enable_signup` must stay true (it toggles the whole email provider locally). | Passwordless; no self-registration. Found by founder's E2E run 2026-10-24. |
| D-07 | Emailed link opens a confirm page; sign-in completes only on button press (POST). | Microsoft 365 Safe Links and similar scanners pre-open links and would consume one-time tokens. |
| D-08 | Session-dependent UI rendered inside `<Suspense>`; no session data cached across requests. | Required by Next.js 16 Cache Components; correctness over speed for now. |
| D-09 | Member display name/email stored on memberships, operator-managed (no client write). | App can show people without reading Supabase's private auth tables. |
| D-10 | Archived projects cannot be edited until restored; no hard delete. | Preserves history. |
| D-11 | Uploads go browser → Supabase Storage via one-time signed URL; server verifies stored bytes afterwards. | Vercel request-body limit (~4.5 MB) would break server-side uploads of engineering PDFs. |
| D-12 | Pilot accepts PDF, PNG, JPG, TXT ≤ 25 MB; everything else is recorded as blocked with a hint (CAD/BIM/GIS → export to PDF/PNG). | Matches brief; XLSX deferred. |
| D-13 | The writer of a fact revision cannot approve or reject it, unless they are an admin; admin self-approvals are flagged `self_approved` and shown in the UI and audit log. | Founder decision 2026-10-25. |
| D-14 | Every approved fact needs ≥1 citation to a stored source version (page or section + excerpt). Editing creates a new candidate revision; prior approval stays only on the old revision. | No unsourced evidence; edits invalidate approval. |
| D-15 | Reviewers may also propose and edit facts (their own revisions then need another reviewer). | Review screens need edit, per brief. |
| D-16 | Gaps/conflicts: same separation of duties as facts (raiser can't close unless admin, flagged). Open gaps don't block drafting; they become explicit "information needed" markers. Facts in open conflicts and non-prevailing facts are excluded from snapshots. | Consistent with D-13; brief requires gaps to surface, not be filled. |
| D-17 | Vercel hosts only the web app. No file bytes through Vercel Functions; verification/processing runs as Trigger.dev jobs with visible job ids; Gotenberg is a private container called only from jobs. | Founder directive 2026-10-25; Vercel 4.5 MB body limit. |
| D-18 | The Supabase service-role key exists only in local dev and the Trigger.dev worker; the app refuses to run on Vercel if it is configured there. | Keeps privileged credentials out of request-handling code. |
| D-19 | Dev / preview / production use separate Supabase projects, Trigger.dev environments and email senders; preview holds synthetic data only. | Founder directive. |
| D-03 | Composite FKs `(project_id, org_id)` for all project-owned tables. | Firm ownership enforced by the database, not just by code. |

## Unresolved provider details (do not configure until verified)
| ID | Item |
|---|---|
| U-01 | Exact Anthropic API model identifiers, availability and pricing for "Claude Opus 5.5" and "Fable 5.1". To be verified against official Anthropic docs at Phase 3. |
| U-02 | Docxtemplater image-module licence terms and cost. |
| U-03 | Azure Document Intelligence model choice, region, data-retention terms. |
| U-04 | Malware-scanning integration (required before live confidential use). |
| U-06 | Production email sender (SMTP provider) for magic links — required before any hosted/pilot use. Local dev uses the built-in test inbox. |
| U-07 | Trigger.dev: account, plan/pricing, region and data handling; whether its bundler resolves the `@/` path alias (worker code uses relative imports to avoid depending on it). | 
| U-08 | Vercel Pro is required for commercial use (Hobby is non-commercial) — approval needed before any firm-facing deployment. |
| U-05 | Supabase key naming: newer projects issue "publishable" and "secret" keys; confirm what your local CLI prints at milestone 1.3. |

## Security gaps to close before live confidential use
| ID | Gap | Planned fix |
|---|---|---|
| S-01 | No malware scanning. Every file shows "Not scanned". | Choose scanner (U-04); scanner sets `scan_status` via service role; block processing until `clean`. |
| S-02 | ~~User-callable upload completion could skip the content check.~~ **Closed in 1.8c:** the function was dropped; only the service-role worker can finish uploads (tested). | — |
| S-03 | Bytes of files blocked *after* upload remain in the private bucket (unreadable to users). | Phase 2 cleanup job deletes them via the Storage API. |
| S-04 | Storage policies are tested on the shim; on real Supabase they are covered by end-to-end upload tests only. | Add Storage API-level tests in Phase 5. |

## Open questions for the founder (not blocking yet)
| ID | Question | Needed by |
|---|---|---|
| Q-01 | Which firm and document type will the pilot use? | Phase 3 |
| Q-02 | GitHub account/org name for the private repo. | Now (to push) |
