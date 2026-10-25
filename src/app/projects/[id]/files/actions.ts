"use server";

import { z } from "zod";
import { hasRole, requireMembership } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { BLOCK_REASON_TEXT, preflight, sanitizeFilename } from "@/lib/files";
import { BUCKET, getVersion } from "@/lib/sources";
import { jobRunner } from "@/lib/server-env";
import { enqueueTextExtraction, enqueueUploadVerification } from "@/lib/jobs/enqueue";

export type StartResult =
  | { kind: "upload"; versionId: string; path: string; token: string; mime: string }
  | { kind: "blocked"; message: string }
  | { kind: "error"; message: string };

export type FinishResult = { kind: "queued"; jobId: string } | { kind: "error"; message: string; jobId?: string };

const startSchema = z.object({
  projectId: z.uuid(),
  sourceId: z.union([z.uuid(), z.literal("")]).transform((v) => v || null),
  filename: z.string().min(1).max(1000),
  size: z.number().int().nonnegative(),
});

const GENERIC = "The file could not be uploaded. Please try again.";

/**
 * Step 1 — runs before any bytes leave the browser. Checks role, project,
 * name and size; records blocked files; issues a one-time upload URL otherwise.
 */
export async function startUpload(input: z.input<typeof startSchema>): Promise<StartResult> {
  const m = await requireMembership();
  if (!hasRole(m, ["admin", "author"])) return { kind: "error", message: "Your role cannot upload files." };
  const parsed = startSchema.safeParse(input);
  if (!parsed.success) return { kind: "error", message: GENERIC };
  const { projectId, sourceId, size } = parsed.data;
  const filename = sanitizeFilename(parsed.data.filename);
  const check = preflight(filename, size);

  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("begin_source_upload", {
      p_project_id: projectId,
      p_source_id: sourceId,
      p_filename: filename,
      p_byte_size: size,
      p_declared_mime: check.ok ? check.mime : "",
      p_block_reason: check.ok ? null : check.reason,
    })
    .single<{ version_id: string; storage_path: string | null; status: string }>();
  if (error || !data) {
    console.warn("[files] begin failed", { code: error?.code });
    return { kind: "error", message: error?.message?.includes("archived") ? "This project is archived." : GENERIC };
  }
  if (!check.ok) return { kind: "blocked", message: check.message };

  const { data: signed, error: signErr } = await supabase.storage.from(BUCKET).createSignedUploadUrl(data.storage_path!);
  if (signErr || !signed) {
    console.warn("[files] signed upload url failed", { status: signErr?.name });
    return { kind: "error", message: GENERIC };
  }
  return { kind: "upload", versionId: data.version_id, path: data.storage_path!, token: signed.token, mime: check.mime };
}

/**
 * Step 3 — after the browser has uploaded. Does NOT read the file here (Vercel
 * Functions must not carry large files). It records a verification job and hands
 * it to the background runner, returning the job id for the UI to follow.
 */
export async function requestVerification(input: { projectId: string; versionId: string }): Promise<FinishResult> {
  const m = await requireMembership();
  if (!hasRole(m, ["admin", "author"])) return { kind: "error", message: "Your role cannot upload files." };
  const ids = z.object({ projectId: z.uuid(), versionId: z.uuid() }).safeParse(input);
  if (!ids.success) return { kind: "error", message: GENERIC };

  let runner: "local" | "trigger";
  try {
    runner = jobRunner();
  } catch (e) {
    console.error("[files] job runner misconfigured", { message: (e as Error).message });
    return { kind: "error", message: "Background processing is not configured. Contact your administrator." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("request_upload_verification", { p_version_id: ids.data.versionId, p_runner: runner })
    .single<{ job_id: string; request_count: number; status: string; enqueue: boolean }>();
  if (error || !data) {
    console.warn("[files] verification request failed", { code: error?.code });
    return { kind: "error", message: GENERIC };
  }
  if (data.enqueue) {
    try {
      await enqueueUploadVerification(data);
    } catch (e) {
      console.warn("[files] enqueue failed", { name: (e as Error).name });
      return { kind: "error", message: "Verification could not be started. Use Retry on the file to try again.", jobId: data.job_id };
    }
  }
  return { kind: "queued", jobId: data.job_id };
}

export type JobView = {
  jobStatus: "queued" | "running" | "succeeded" | "failed";
  versionStatus: "uploading" | "stored" | "blocked";
  message?: string;
};

/** Polled by the upload form. Reads through row-level security as the user. */
export async function getVerificationStatus(input: { projectId: string; versionId: string; jobId: string }): Promise<JobView | null> {
  const m = await requireMembership();
  const ids = z.object({ projectId: z.uuid(), versionId: z.uuid(), jobId: z.uuid() }).safeParse(input);
  if (!ids.success) return null;
  const supabase = await createClient();
  const [{ data: job }, version] = await Promise.all([
    supabase.from("processing_jobs").select("status, error_code").eq("id", ids.data.jobId).eq("org_id", m.orgId).maybeSingle(),
    getVersion(m.orgId, ids.data.projectId, ids.data.versionId),
  ]);
  if (!job || !version) return null;
  return {
    jobStatus: job.status,
    versionStatus: version.status,
    message: version.block_reason ? BLOCK_REASON_TEXT[version.block_reason] : (job.error_code ?? undefined),
  };
}

/** Requests (or retries) text extraction for a stored file. Admins and authors only. */
export async function requestExtraction(input: { projectId: string; versionId: string }): Promise<FinishResult> {
  const m = await requireMembership();
  if (!hasRole(m, ["admin", "author"])) return { kind: "error", message: "Your role cannot start text extraction." };
  const ids = z.object({ projectId: z.uuid(), versionId: z.uuid() }).safeParse(input);
  if (!ids.success) return { kind: "error", message: GENERIC };
  let runner: "local" | "trigger";
  try {
    runner = jobRunner();
  } catch {
    return { kind: "error", message: "Background processing is not configured. Contact your administrator." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("request_text_extraction", { p_version_id: ids.data.versionId, p_runner: runner })
    .single<{ job_id: string; request_count: number; status: string; enqueue: boolean }>();
  if (error || !data) return { kind: "error", message: "Text extraction could not be started." };
  if (data.enqueue) {
    try {
      await enqueueTextExtraction(data);
    } catch {
      return { kind: "error", message: "Text extraction could not be started. Try again.", jobId: data.job_id };
    }
  }
  return { kind: "queued", jobId: data.job_id };
}
