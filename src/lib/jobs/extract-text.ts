/**
 * Text-extraction job (worker only). Re-reads the stored original, confirms its
 * SHA-256 still matches what verification recorded (never trusting earlier steps),
 * extracts page text, and records it as DERIVED data.
 */
import { createHash } from "node:crypto";
import { tasks } from "@trigger.dev/sdk";
import { version as pdfjsVersion } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { extractTextTask } from "../../trigger/extract-text";
import { BUCKET } from "../files";
import { createAdminClient } from "../supabase/admin";
import { JobError, errorCode } from "./errors";
import { EXTRACTOR_NAME, extractPages } from "./extract-pages";

type StartedJob = { kind: string; subject_id: string; status: string; storage_path: string | null };

export async function runTextExtraction(jobId: string, externalRunId: string | null): Promise<string> {
  const admin = createAdminClient();
  const { data: job, error } = await admin
    .rpc("worker_start_job", { p_job_id: jobId, p_external_run_id: externalRunId })
    .single<StartedJob>();
  if (error || !job) throw new JobError("job_not_found");
  if (job.kind !== "extract_text") throw new JobError("wrong_job_kind");

  const { data: ver, error: vErr } = await admin
    .from("source_versions")
    .select("status, detected_type, sha256, storage_path")
    .eq("id", job.subject_id)
    .single();
  if (vErr || !ver || ver.status !== "stored" || !ver.storage_path) throw new JobError("file_not_stored");

  const { data: blob, error: dlErr } = await admin.storage.from(BUCKET).download(ver.storage_path);
  if (dlErr || !blob) throw new JobError("storage_unavailable");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== ver.sha256) throw new JobError("content_changed");

  const result = await extractPages(ver.detected_type, bytes);
  const { data, error: fErr } = await admin.rpc("worker_finish_extraction", {
    p_job_id: jobId,
    p_status: result.status,
    p_method: result.method,
    p_extractor: ver.detected_type === "pdf" ? `${EXTRACTOR_NAME} ${pdfjsVersion}` : "built-in",
    p_pages: result.pages,
  });
  if (fErr) throw new JobError("finish_failed");
  return data as string;
}

/**
 * Called by the worker right after a file is stored: creates (or re-uses) the
 * extraction job and runs it. JOB_RUNNER=trigger hands it to Trigger.dev; otherwise
 * (local development only) it runs here, in sequence.
 */
export async function dispatchExtraction(versionId: string): Promise<void> {
  const runner = process.env.JOB_RUNNER === "trigger" ? "trigger" : "local";
  const admin = createAdminClient();
  const { data, error } = await admin
    .rpc("worker_request_extraction", { p_version_id: versionId, p_runner: runner })
    .single<{ job_id: string; request_count: number; enqueue: boolean }>();
  if (error || !data) throw new JobError("extraction_request_failed");
  if (!data.enqueue) return;
  await runOrHandOff(data, runner);
}

export async function runOrHandOff(job: { job_id: string; request_count: number }, runner: "local" | "trigger") {
  if (runner === "trigger") {
    await tasks.trigger<typeof extractTextTask>(
      "extract-text",
      { jobId: job.job_id },
      { idempotencyKey: `extract_text:${job.job_id}:${job.request_count}` },
    );
    return;
  }
  try {
    await runTextExtraction(job.job_id, `local-${job.request_count}`);
  } catch (e) {
    await failJobQuietly(job.job_id, errorCode(e));
  }
}

async function failJobQuietly(jobId: string, code: string) {
  const admin = createAdminClient();
  await admin.rpc("worker_fail_job", { p_job_id: jobId, p_error_code: code });
}
