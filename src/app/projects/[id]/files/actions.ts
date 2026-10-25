"use server";

import { createHash } from "node:crypto";
import { z } from "zod";
import { hasRole, requireMembership } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { BLOCK_REASON_TEXT, checkContent, preflight, sanitizeFilename, type BlockReason } from "@/lib/files";
import { BUCKET, getVersion } from "@/lib/sources";

export type StartResult =
  | { kind: "upload"; versionId: string; path: string; token: string; mime: string }
  | { kind: "blocked"; message: string }
  | { kind: "error"; message: string };

export type FinishResult = { kind: "stored" } | { kind: "blocked"; message: string } | { kind: "error"; message: string };

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
 * Step 3 — after the browser has uploaded. Re-reads the STORED bytes (never
 * trusting the browser), checks size, signature and text validity, computes a
 * SHA-256 fingerprint, then marks the version stored or blocked.
 */
export async function finishUpload(input: { projectId: string; versionId: string }): Promise<FinishResult> {
  const m = await requireMembership();
  const ids = z.object({ projectId: z.uuid(), versionId: z.uuid() }).safeParse(input);
  if (!ids.success) return { kind: "error", message: GENERIC };

  const version = await getVersion(m.orgId, ids.data.projectId, ids.data.versionId);
  if (!version || version.uploaded_by !== m.user.id || version.status !== "uploading" || !version.storage_path) {
    return { kind: "error", message: GENERIC };
  }
  const expected = preflight(version.original_filename, version.byte_size);
  if (!expected.ok) return { kind: "error", message: GENERIC };

  const supabase = await createClient();
  const block = async (reason: BlockReason): Promise<FinishResult> => {
    await supabase.rpc("complete_source_upload", {
      p_version_id: version.id,
      p_sha256: null,
      p_detected_type: null,
      p_block_reason: reason,
    });
    return { kind: "blocked", message: BLOCK_REASON_TEXT[reason] };
  };

  const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET).download(version.storage_path);
  if (dlErr || !blob) return block("missing_upload");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length !== version.byte_size) return block("size_mismatch");

  const content = checkContent(expected.expectedType, bytes);
  if (!content.ok) return block(content.reason);

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const { error } = await supabase.rpc("complete_source_upload", {
    p_version_id: version.id,
    p_sha256: sha256,
    p_detected_type: content.detectedType,
    p_block_reason: null,
  });
  if (error) {
    console.warn("[files] complete failed", { code: error.code });
    return { kind: "error", message: GENERIC };
  }
  return { kind: "stored" };
}
