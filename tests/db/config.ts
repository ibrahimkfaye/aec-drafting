/** Connection settings for the LOCAL test database. Never point these at a live database. */
const base = process.env.TEST_DATABASE_ADMIN_URL ?? "postgresql://postgres:postgres@localhost:5432/postgres";

export function testDbName(): string {
  const name = process.env.TEST_DATABASE_NAME ?? "aec_test";
  if (!/^[a-z0-9_]+_test$/.test(name)) throw new Error(`Refusing: test DB name must end in _test (got ${name})`);
  return name;
}

export function adminUrl(): string {
  const host = new URL(base).hostname;
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
    throw new Error(`Refusing: database tests only run against localhost (got ${host})`);
  }
  return base;
}

export function testUrl(): string {
  const u = new URL(adminUrl());
  u.pathname = `/${testDbName()}`;
  return u.toString();
}
