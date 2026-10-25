/**
 * LOCAL-ONLY seed: two SYNTHETIC firms, one user per role in the first, an admin
 * in the second (for cross-firm isolation tests), and a user with no firm.
 * Safe to run repeatedly.
 *
 *   npm run seed:local
 *
 * Refuses to run unless NEXT_PUBLIC_SUPABASE_URL points at localhost.
 * Emails use the reserved .test domain; locally they land in the test inbox
 * (http://127.0.0.1:54324) and are never delivered.
 */
import { createClient } from "@supabase/supabase-js";

const FIRMS = [
  { id: "00000000-0000-4000-8000-000000000001", name: "SYNTHETIC Sample Firm (dev only)" },
  { id: "00000000-0000-4000-8000-000000000002", name: "SYNTHETIC Other Firm (dev only)" },
] as const;

type Role = "admin" | "author" | "reviewer" | "viewer";
const USERS: { email: string; name: string; firm: string | null; role: Role | null }[] = [
  { email: "admin@example.test", name: "Avery Admin (synthetic)", firm: FIRMS[0].id, role: "admin" },
  { email: "author@example.test", name: "Alex Author (synthetic)", firm: FIRMS[0].id, role: "author" },
  { email: "reviewer@example.test", name: "Riley Reviewer (synthetic)", firm: FIRMS[0].id, role: "reviewer" },
  { email: "viewer@example.test", name: "Val Viewer (synthetic)", firm: FIRMS[0].id, role: "viewer" },
  { email: "other-admin@example.test", name: "Olive Other (synthetic)", firm: FIRMS[1].id, role: "admin" },
  { email: "nomember@example.test", name: "", firm: null, role: null },
];

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new Error("Missing env. Run `npm run env:local` first.");
  const host = new URL(url).hostname;
  if (!["127.0.0.1", "localhost"].includes(host)) throw new Error(`Refusing: not a local Supabase URL (${host}).`);

  const admin = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });

  for (const firm of FIRMS) {
    const { error } = await admin.from("organizations").upsert({ id: firm.id, name: firm.name } as { id: string; name: string });
    if (error) throw new Error(`organizations: ${error.message}`);
  }

  const { data: list, error: listErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (listErr) throw new Error(`listUsers: ${listErr.message}`);

  for (const u of USERS) {
    let id = list.users.find((x) => x.email === u.email)?.id;
    if (!id) {
      const { data, error } = await admin.auth.admin.createUser({ email: u.email, email_confirm: true });
      if (error) throw new Error(`createUser ${u.email}: ${error.message}`);
      id = data.user.id;
    }
    if (u.firm && u.role) {
      const { error } = await admin
        .from("memberships")
        .upsert(
          { org_id: u.firm, user_id: id, role: u.role, display_name: u.name, email: u.email },
          { onConflict: "org_id,user_id" },
        );
      if (error) throw new Error(`membership ${u.email}: ${error.message}`);
    }
    const firmName = FIRMS.find((f) => f.id === u.firm)?.name ?? "(no firm)";
    console.log(`  ${u.email.padEnd(26)} ${(u.role ?? "-").padEnd(9)} ${firmName}`);
  }
  console.log("Seeded SYNTHETIC test data.");
}

main().catch((e) => {
  console.error(`Seed failed: ${(e as Error).message}`);
  process.exit(1);
});
