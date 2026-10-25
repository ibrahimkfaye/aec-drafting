/**
 * Connection settings for database tests. LOCAL ONLY — never point at a live database.
 *
 * TEST_TARGET=shim (default): plain PostgreSQL + tests/db/supabase-shim.sql.
 *   A throwaway database named *_test is dropped and recreated each run.
 * TEST_TARGET=supabase-local: the real local Supabase stack from `npx supabase start`
 *   (port 54322). Migrations are applied by Supabase itself (`npx supabase db reset`);
 *   nothing is dropped. Test rows are synthetic and cleared by the next `db reset`.
 */
export type TestTarget = "shim" | "supabase-local";

export function testTarget(): TestTarget {
  const t = process.env.TEST_TARGET ?? "shim";
  if (t !== "shim" && t !== "supabase-local") throw new Error(`Unknown TEST_TARGET: ${t}`);
  return t;
}

function assertLocal(url: string): URL {
  const u = new URL(url);
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(u.hostname)) {
    throw new Error(`Refusing: database tests only run against localhost (got ${u.hostname})`);
  }
  return u;
}

export function testDbName(): string {
  const name = process.env.TEST_DATABASE_NAME ?? "aec_test";
  if (!/^[a-z0-9_]+_test$/.test(name)) throw new Error(`Refusing: test DB name must end in _test (got ${name})`);
  return name;
}

export function adminUrl(): string {
  return assertLocal(
    process.env.TEST_DATABASE_ADMIN_URL ?? "postgresql://postgres:postgres@localhost:5432/postgres",
  ).toString();
}

export function testUrl(): string {
  if (testTarget() === "supabase-local") {
    const u = assertLocal(
      process.env.SUPABASE_LOCAL_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    );
    if (u.port !== "54322") throw new Error(`Refusing: expected local Supabase DB port 54322 (got ${u.port})`);
    return u.toString();
  }
  const u = new URL(adminUrl());
  u.pathname = `/${testDbName()}`;
  return u.toString();
}
