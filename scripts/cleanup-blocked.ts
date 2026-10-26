/**
 * LOCAL-ONLY cleanup sweep (in hosted environments this becomes the scheduled
 * Trigger.dev task in src/trigger/cleanup-blocked.ts):
 *   1. uploads unfinished for over 24 hours are marked "blocked: upload never finished";
 *   2. the bytes of every blocked file are deleted from storage and the deletion recorded.
 * Stored files are never touched (the database only lists blocked ones).
 * Prints counts only — no file names.
 *
 *   npm run cleanup:blocked
 */
import { runCleanupSweep } from "../src/lib/jobs/clear-blocked";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || !process.env.SUPABASE_SECRET_KEY) throw new Error("Missing env. Run `npm run env:local` first.");
  const host = new URL(url).hostname;
  if (!["127.0.0.1", "localhost"].includes(host)) throw new Error(`Refusing: not a local Supabase URL (${host}).`);
  const r = await runCleanupSweep();
  console.log(`Abandoned uploads marked blocked: ${r.abandoned}`);
  console.log(`Blocked files cleared from storage: ${r.cleared}`);
  console.log(`Could not clear (will retry next run): ${r.failed}`);
  if (r.failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : "cleanup failed");
  process.exit(1);
});
