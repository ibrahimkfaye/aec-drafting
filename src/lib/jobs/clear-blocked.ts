/**
 * Clears file bytes that must not be kept: blocked uploads and abandoned uploads.
 * Runs only in the worker / operator tooling (service role). The DATABASE decides
 * which objects may be deleted (blocked versions only); this code deletes them via
 * the Storage API and then asks the database to record it, which it does only once
 * the object is really gone. Results are counts only — never file names or paths.
 */
import { BUCKET } from "../files";
import { createAdminClient } from "../supabase/admin";
import { JobError } from "./errors";

type Admin = Pick<ReturnType<typeof createAdminClient>, "rpc" | "storage">;

export type ClearResult = { cleared: number; failed: number };

const BATCH = 100;

/** Deletes and records the bytes of blocked versions (all of them, or just one). */
export async function clearBlockedBytes(admin: Admin, versionId: string | null = null): Promise<ClearResult> {
  const out: ClearResult = { cleared: 0, failed: 0 };
  const seen = new Set<string>();
  for (;;) {
    const { data, error } = await admin.rpc("worker_bytes_to_clear", { p_version_id: versionId, p_limit: BATCH });
    if (error) throw new JobError("cleanup_list_failed");
    const rows = ((data ?? []) as { version_id: string; storage_path: string }[]).filter((r) => !seen.has(r.version_id));
    if (rows.length === 0) return out;
    rows.forEach((r) => seen.add(r.version_id));

    const { error: rmErr } = await admin.storage.from(BUCKET).remove(rows.map((r) => r.storage_path));
    if (rmErr) {
      out.failed += rows.length;
      continue;
    }
    for (const r of rows) {
      const { error: recErr } = await admin.rpc("worker_record_bytes_cleared", { p_version_id: r.version_id });
      if (recErr) out.failed += 1;
      else out.cleared += 1;
    }
  }
}

/** Full sweep: mark uploads abandoned for over 24 hours as blocked, then clear all blocked bytes. */
export async function runCleanupSweep(admin: Admin = createAdminClient()): Promise<ClearResult & { abandoned: number }> {
  const { data, error } = await admin.rpc("worker_block_abandoned_uploads", { p_older_than: "24 hours" });
  if (error) throw new JobError("cleanup_abandoned_failed");
  return { abandoned: Number(data ?? 0), ...(await clearBlockedBytes(admin)) };
}
