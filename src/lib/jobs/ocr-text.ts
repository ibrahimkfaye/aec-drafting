/**
 * OCR job (worker only). Re-reads the stored original, confirms its SHA-256 still
 * matches, runs LOCAL OCR, and records the text as DERIVED data labelled "ocr".
 * The database refuses OCR for files that have a text layer.
 */
import { createHash } from "node:crypto";
import { tasks } from "@trigger.dev/sdk";
import type { ocrTextTask } from "../../trigger/ocr-text";
import { BUCKET } from "../files";
import { createAdminClient } from "../supabase/admin";
import { JobError, errorCode } from "./errors";
import { OCR_LANGUAGE, ocrEngineName, ocrPages } from "./ocr-pages";

type StartedJob = { kind: string; subject_id: string };

export async function runOcr(jobId: string, externalRunId: string | null): Promise<string> {
  const admin = createAdminClient();
  const { data: job, error } = await admin
    .rpc("worker_start_job", { p_job_id: jobId, p_external_run_id: externalRunId })
    .single<StartedJob>();
  if (error || !job) throw new JobError("job_not_found");
  if (job.kind !== "ocr_text") throw new JobError("wrong_job_kind");

  const { data: ver, error: vErr } = await admin
    .from("source_versions")
    .select("status, detected_type, sha256, storage_path")
    .eq("id", job.subject_id)
    .single();
  if (vErr || !ver || ver.status !== "stored" || !ver.storage_path) throw new JobError("file_not_stored");
  if (ver.detected_type === "text") throw new JobError("ocr_not_applicable");

  const { data: blob, error: dlErr } = await admin.storage.from(BUCKET).download(ver.storage_path);
  if (dlErr || !blob) throw new JobError("storage_unavailable");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== ver.sha256) throw new JobError("content_changed");

  const result = await ocrPages(ver.detected_type, bytes);
  const { data, error: fErr } = await admin.rpc("worker_finish_ocr", {
    p_job_id: jobId,
    p_status: result.status,
    p_engine: ocrEngineName(),
    p_language: OCR_LANGUAGE,
    p_render_dpi: result.renderDpi,
    p_pages: result.pages,
  });
  if (fErr) throw new JobError("finish_failed");
  return data as string;
}

/** Runs locally (development only) or hands off to Trigger.dev. */
export async function runOrHandOffOcr(job: { job_id: string; request_count: number }, runner: "local" | "trigger") {
  if (runner === "trigger") {
    await tasks.trigger<typeof ocrTextTask>("ocr-text", { jobId: job.job_id }, { idempotencyKey: `ocr_text:${job.job_id}:${job.request_count}` });
    return;
  }
  try {
    await runOcr(job.job_id, `local-${job.request_count}`);
  } catch (e) {
    await createAdminClient().rpc("worker_fail_job", { p_job_id: job.job_id, p_error_code: errorCode(e) });
  }
}
