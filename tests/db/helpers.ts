import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { testUrl } from "./config";

export const pool = new Pool({ connectionString: testUrl(), max: 4 });

export type Role = "admin" | "author" | "reviewer" | "viewer";

/** Run as the database owner (like Supabase's service role / operator tooling). */
export async function asOwner<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    return await fn(c);
  } finally {
    c.release();
  }
}

/**
 * Run `fn` inside a transaction as a signed-in user, exactly as Supabase's API
 * would: role `authenticated` with the user's id as the JWT `sub` claim.
 * Pass userId = null to act as the anonymous (signed-out) role.
 */
export async function asUser<T>(userId: string | null, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query(`set local role ${userId ? "authenticated" : "anon"}`);
    await c.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? ""]);
    const out = await fn(c);
    await c.query("commit");
    return out;
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}

export async function createUser(): Promise<string> {
  const id = randomUUID();
  await asOwner((c) => c.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id}@example.test`]));
  return id;
}

/** SYNTHETIC test firm with one user per requested role. */
export async function seedFirm(roles: Role[] = ["admin", "author", "reviewer", "viewer"]) {
  const orgId = randomUUID();
  await asOwner((c) => c.query("insert into organizations (id, name) values ($1, $2)", [orgId, `Synthetic Firm ${orgId.slice(0, 8)}`]));
  const users: Partial<Record<Role, string>> = {};
  for (const role of roles) {
    const uid = await createUser();
    await asOwner((c) => c.query("insert into memberships (org_id, user_id, role) values ($1, $2, $3)", [orgId, uid, role]));
    users[role] = uid;
  }
  return { orgId, users: users as Record<Role, string> };
}

export function projectInput(orgId: string, createdBy: string, extra: Record<string, unknown> = {}) {
  return {
    org_id: orgId,
    name: "SYNTHETIC Sample Project",
    client_name: "SYNTHETIC Client",
    location: "SYNTHETIC Location",
    document_type: "sample_technical_memo",
    created_by: createdBy,
    ...extra,
  };
}

export async function insertProject(c: PoolClient, input: Record<string, unknown>) {
  const keys = Object.keys(input);
  const sql = `insert into projects (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`;
  const { rows } = await c.query(sql, Object.values(input));
  return rows[0];
}

/** Run as Supabase's server-side service role (what the background worker uses). */
export async function asService<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("set local role service_role");
    const out = await fn(c);
    await c.query("commit");
    return out;
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}
