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

## Local Supabase (database, auth, storage on your Mac)

Docker Desktop must be running. The Supabase CLI is installed with the project
(`npm install`), so always call it through `npx`.

```bash
npm run db:start     # first run downloads images (several GB, 5-15 min)
npm run db:reset     # wipes the LOCAL database and re-applies all migrations
npx supabase status  # shows local URLs and keys
npm run db:stop      # when you are done for the day
```

Local Studio (a database viewer) is at http://127.0.0.1:54323.

## Run the tests

```bash
npm run test:db:supabase   # access-control tests against your real local Supabase
npm run typecheck
npm run lint
```

Faster alternative without Supabase (plain PostgreSQL + a test-only shim):

```bash
docker run -d --name aec-test-db -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
npm run test:db
```

Both test modes **refuse** to run against anything other than `localhost`.
The shim mode drops and recreates a database named `*_test` each run.

## Database migrations

SQL migrations live in `supabase/migrations/` and are applied in filename order.
Never edit a migration that has been applied to a shared or live database — add a
new one. Applying to a hosted Supabase project will be documented at milestone 1.3+.

## Secrets

- Only `NEXT_PUBLIC_*` values may reach the browser. The Supabase secret key and
  all provider API keys are server-only.
- `.env*` files are git-ignored except `.env.example`.
