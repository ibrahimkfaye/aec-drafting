# AEC Drafting Pilot

Source-grounded document-drafting pilot for architecture, engineering and
construction firms. Drafts are produced only from human-approved evidence and
require final human review before release. The software assists drafting; it
does not guarantee factual accuracy or replace professional judgment.

> **Status: development build, Phase 1 in progress.** No sign-in, uploads, AI or
> export yet. Do not use with confidential data. See `docs/MILESTONES.md`.

- `docs/ARCHITECTURE.md` — components, trust boundaries, roles
- `docs/MILESTONES.md` — what is done / next
- `docs/ASSUMPTIONS.md` — assumptions, decisions, open questions

## One-time setup (Mac, Apple Silicon)

Open **Terminal** (Cmd+Space, type "Terminal") and run each block.

1. **Homebrew** (skip if `brew --version` works):
   ```bash
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```
   Follow the "Next steps" it prints (it adds brew to your PATH).
2. **Node.js 22 and Git:**
   ```bash
   brew install node@22 git
   brew link --overwrite node@22
   node -v   # should print v22.x
   ```
3. **Docker Desktop** must be running (whale icon in the menu bar).

## Install the project

```bash
cd ~/Projects/aec-drafting     # wherever you cloned it
npm install
cp .env.example .env.local     # .env.local is git-ignored; never commit it
```

## Run the app

```bash
npm run dev
```
Open http://localhost:3000.

## Run the tests

Database policy tests need a disposable local PostgreSQL. Start one in Docker:

```bash
docker run -d --name aec-test-db -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
```
(Next time: `docker start aec-test-db`.) Then:

```bash
npm test            # all tests
npm run test:db     # database access-control tests only
npm run typecheck
npm run lint
```

The test runner **refuses** to run against anything other than `localhost` and a
database whose name ends in `_test`; it drops and recreates that database each run.

## Database migrations

SQL migrations live in `supabase/migrations/` and are applied in filename order.
Never edit a migration that has been applied to a shared or live database — add a
new one. Applying to a hosted Supabase project will be documented at milestone 1.3+.

## Secrets

- Only `NEXT_PUBLIC_*` values may reach the browser. The Supabase secret key and
  all provider API keys are server-only.
- `.env*` files are git-ignored except `.env.example`.
