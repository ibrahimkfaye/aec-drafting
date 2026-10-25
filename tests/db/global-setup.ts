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
import { adminUrl, testDbName, testUrl } from "./config";

export default async function setup() {
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
