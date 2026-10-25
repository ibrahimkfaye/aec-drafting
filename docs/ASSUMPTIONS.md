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
| A-08 | Node.js 22 LTS on all machines (`.nvmrc`). | Proposed |

## Decisions
| ID | Decision | Why |
|---|---|---|
| D-01 | DB policy tests run on plain PostgreSQL with a test-only shim (`tests/db/supabase-shim.sql`), plus later on a real Supabase stack. | Fast feedback without Docker; the shim is never applied to a real project. |
| D-02 | Removed Google-hosted fonts from the scaffold; system font stack. | Avoids a build-time external network dependency. |
| D-04 | Supabase CLI installed per-project via npm (`npx supabase`), not globally. | Everyone uses the same pinned version. |
| D-05 | Unused local Supabase services disabled in `config.toml`. | Lower memory/disk use on a laptop; re-enable if needed. |
| D-06 | Sign-in by magic link (founder's choice). Sign-ups disabled; operator creates users. | Passwordless; no self-registration. |
| D-07 | Emailed link opens a confirm page; sign-in completes only on button press (POST). | Microsoft 365 Safe Links and similar scanners pre-open links and would consume one-time tokens. |
| D-08 | Session-dependent UI rendered inside `<Suspense>`; no session data cached across requests. | Required by Next.js 16 Cache Components; correctness over speed for now. |
| D-03 | Composite FKs `(project_id, org_id)` for all project-owned tables. | Firm ownership enforced by the database, not just by code. |

## Unresolved provider details (do not configure until verified)
| ID | Item |
|---|---|
| U-01 | Exact Anthropic API model identifiers, availability and pricing for "Claude Opus 5.5" and "Fable 5.1". To be verified against official Anthropic docs at Phase 3. |
| U-02 | Docxtemplater image-module licence terms and cost. |
| U-03 | Azure Document Intelligence model choice, region, data-retention terms. |
| U-04 | Malware-scanning integration (required before live confidential use). |
| U-06 | Production email sender (SMTP provider) for magic links — required before any hosted/pilot use. Local dev uses the built-in test inbox. |
| U-05 | Supabase key naming: newer projects issue "publishable" and "secret" keys; confirm what your local CLI prints at milestone 1.3. |

## Open questions for the founder (not blocking yet)
| ID | Question | Needed by |
|---|---|---|
| Q-01 | Which firm and document type will the pilot use? | Phase 3 |
| Q-02 | GitHub account/org name for the private repo. | Now (to push) |
| Q-04 | Must the person who entered a fact be blocked from approving it? (Proposed: yes.) | 1.8 |
