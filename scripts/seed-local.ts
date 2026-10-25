/**
 * LOCAL-ONLY seed: one SYNTHETIC firm and one SYNTHETIC user per role, plus a
 * user with no firm membership. Safe to run repeatedly.
 *
 *   npm run seed:local
 *
 * Refuses to run unless NEXT_PUBLIC_SUPABASE_URL points at localhost.
 * Emails use the reserved .test domain; locally they land in the test inbox
 * (http://127.0.0.1:54324) and are never delivered.
 */
import { createClient } from "@supabase/supabase-js";

export const SEED_ORG_ID = "00000000-0000-4000-8000-000000000001";
export const SEED_USERS = [
  { email: "admin@example.test", role: "admin" },
  { email: "author@example.test", role: "author" },
  { email: "reviewer@example.test", role: "reviewer" },
  { email: "viewer@example.test", role: "viewer" },
  { email: "nomember@example.test", role: null },
] as const;

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new Error("Missing env. Run `npm run env:local` first.");
  const host = new URL(url).hostname;
  if (!["127.0.0.1", "localhost"].includes(host)) throw new Error(`Refusing: not a local Supabase URL (${host}).`);

  const admin = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });

  const { error: orgErr } = await admin
    .from("organizations")
    .upsert({ id: SEED_ORG_ID, name: "SYNTHETIC Sample Firm (dev only)" });
  if (orgErr) throw new Error(`organizations: ${orgErr.message}`);

  const { data: list, error: listErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (listErr) throw new Error(`listUsers: ${listErr.message}`);

  for (const u of SEED_USERS) {
    let id = list.users.find((x) => x.email === u.email)?.id;
    if (!id) {
      const { data, error } = await admin.auth.admin.createUser({ email: u.email, email_confirm: true });
      if (error) throw new Error(`createUser ${u.email}: ${error.message}`);
      id = data.user.id;
    }
    if (u.role) {
      const { error } = await admin
        .from("memberships")
        .upsert({ org_id: SEED_ORG_ID, user_id: id, role: u.role }, { onConflict: "org_id,user_id" });
      if (error) throw new Error(`membership ${u.email}: ${error.message}`);
    }
    console.log(`  ${u.email.padEnd(24)} ${u.role ?? "(no firm)"}`);
  }
  console.log("Seeded SYNTHETIC Sample Firm (dev only).");
}

main().catch((e) => {
  console.error(`Seed failed: ${(e as Error).message}`);
  process.exit(1);
});
