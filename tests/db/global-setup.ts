/**
 * Vitest global setup for database tests.
 * Creates a throwaway LOCAL database, applies the test shim, then every
 * migration in supabase/migrations in filename order.
 *
 * Safety: refuses to run unless the target is on localhost AND the database
 * name ends in "_test", so it can never drop a real/live database.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { adminUrl, testDbName, testTarget, testUrl } from "./config";

export default async function setup() {
  if (testTarget() === "supabase-local") {
    try {
      return await checkSupabaseLocal();
    } catch (err) {
      // Print plainly: Vitest can obscure errors thrown from global setup.
      console.error(`\n[db test setup] ${(err as Error).message}\n`);
      process.exit(1);
    }
  }

  const admin = new Client({ connectionString: adminUrl() });
  await admin.connect();
  await admin.query(`drop database if exists ${testDbName()} with (force)`);
  await admin.query(`create database ${testDbName()}`);
  await admin.end();

  const db = new Client({ connectionString: testUrl() });
  await db.connect();
  const root = path.resolve(__dirname, "../..");
  await db.query(readFileSync(path.join(root, "tests/db/supabase-shim.sql"), "utf8"));
  const dir = path.join(root, "supabase/migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    try {
      await db.query(readFileSync(path.join(dir, file), "utf8"));
    } catch (err) {
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    }
  }
  await db.end();
}

/** Real local Supabase: migrations must already be applied by `npx supabase db reset`. */
async function checkSupabaseLocal() {
  const db = new Client({ connectionString: testUrl() });
  try {
    await db.connect();
  } catch (err) {
    throw new Error(`Cannot reach local Supabase DB. Is Docker running and did you run "npx supabase start"? (${(err as Error).message})`);
  }
  const { rows } = await db.query("select to_regclass('public.audit_events') is not null as ok");
  await db.end();
  if (!rows[0].ok) throw new Error('Migrations not applied. Run "npx supabase db reset" first.');
}
