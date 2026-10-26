/**
 * Upload verification job: re-reads the STORED bytes of one source version,
 * checks size, signature / UTF-8 validity, computes SHA-256, and finishes the
 * version as stored or blocked. Runs in the worker, never in a Vercel Function.
 *
 * Idempotent: safe to run twice for the same job (the database ignores a second finish).
 * Errors carry short codes only — never file contents or names.
 */
import { createHash } from "node:crypto";
import { BUCKET, checkContent, preflight, type BlockReason } from "../files";
import { createAdminClient } from "../supabase/admin";
import { dispatchExtraction } from "./extract-text";
import { clearBlockedBytes } from "./clear-blocked";

import { JobError } from "./errors";
export { JobError, errorCode } from "./errors";

type StartedJob = {
  kind: string;
  subject_id: string;
  status: string;
  storage_path: string | null;
  original_filename: string | null;
  byte_size: number | null;
};

export async function runUploadVerification(jobId: string, externalRunId: string | null): Promise<string> {
  const admin = createAdminClient();
  const { data: job, error } = await admin
    .rpc("worker_start_job", { p_job_id: jobId, p_external_run_id: externalRunId })
    .single<StartedJob>();
  if (error || !job) throw new JobError("job_not_found");
  if (job.kind !== "verify_upload") throw new JobError("wrong_job_kind");

  const finish = async (block: BlockReason | null, sha256: string | null = null, type: string | null = null) => {
    const { data, error: e } = await admin.rpc("worker_finish_upload", {
      p_job_id: jobId,
      p_sha256: sha256,
      p_detected_type: type,
      p_block_reason: block,
    });
    if (e) throw new JobError("finish_failed");
    await afterFinish(admin, job.subject_id, data as string);
    return data as string;
  };

  if (!job.storage_path || !job.original_filename || job.byte_size == null) return finish("missing_upload");
  const expected = preflight(job.original_filename, job.byte_size);
  if (!expected.ok) return finish(expected.reason);

  const { data: blob, error: dlErr } = await admin.storage.from(BUCKET).download(job.storage_path);
  if (dlErr || !blob) {
    // "Not found" means the browser never delivered the file; anything else may be
    // temporary, so let the runner retry.
    if (/not.?found/i.test(dlErr?.message ?? "")) return finish("missing_upload");
    throw new JobError("storage_unavailable");
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length !== job.byte_size) return finish("size_mismatch");

  const content = checkContent(expected.expectedType, bytes);
  if (!content.ok) return finish(content.reason);
  const result = await finish(null, createHash("sha256").update(bytes).digest("hex"), content.detectedType);
  if (result === "stored") {
    // Next step for a stored file: extract its text. A failure here never undoes
    // the verification; the extraction job records its own status.
    try {
      await dispatchExtraction(job.subject_id);
    } catch {
      /* visible as a missing/failed extraction; the user can retry */
    }
  }
  return result;
}

/** Records the outcome; a blocked file's bytes are deleted straight away (best effort; the sweep retries). */
async function afterFinish(admin: ReturnType<typeof createAdminClient>, versionId: string, result: string) {
  if (result !== "blocked") return;
  try {
    await clearBlockedBytes(admin, versionId);
  } catch {
    /* left for the cleanup sweep */
  }
}

export async function failJob(jobId: string, code: string): Promise<void> {
  const admin = createAdminClient();
  await admin.rpc("worker_fail_job", { p_job_id: jobId, p_error_code: code });
}
