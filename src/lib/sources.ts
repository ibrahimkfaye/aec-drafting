import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { BlockReason, DetectedType } from "@/lib/files";

export { BUCKET } from "@/lib/files";

export type SourceVersionRow = {
  id: string;
  source_id: string;
  version_number: number;
  original_filename: string;
  byte_size: number;
  detected_type: DetectedType | null;
  status: "uploading" | "stored" | "blocked";
  block_reason: BlockReason | null;
  scan_status: "not_scanned" | "clean" | "infected" | "scan_error";
  uploaded_by: string;
  created_at: string;
  storage_path: string | null;
  /** True when an upload never finished (its one-time upload URL has expired). */
  incomplete?: boolean;
  /** Text extraction outcome, or the extraction job still in progress / failed. */
  text?: {
    outcome: { status: "extracted" | "needs_ocr"; page_count: number; pages_with_text: number; method: string } | null;
    job: { id: string; status: "queued" | "running" | "succeeded" | "failed"; error_code: string | null } | null;
  };
  /** Latest background verification job for this version, if any. */
  job?: { id: string; status: "queued" | "running" | "succeeded" | "failed"; error_code: string | null; runner: string } | null;
};

const STALE_UPLOAD_MS = 2 * 60 * 60 * 1000; // signed upload URLs expire after 2 hours

export type SourceWithVersions = { id: string; title: string; created_at: string; versions: SourceVersionRow[] };

const COLUMNS =
  "id, source_id, version_number, original_filename, byte_size, detected_type, status, block_reason, scan_status, uploaded_by, created_at, storage_path";

export async function listSources(orgId: string, projectId: string): Promise<SourceWithVersions[]> {
  const supabase = await createClient();
  const [{ data: sources, error: e1 }, { data: versions, error: e2 }, { data: jobs, error: e3 }, { data: texts, error: e4 }] = await Promise.all([
    supabase.from("sources").select("id, title, created_at").eq("org_id", orgId).eq("project_id", projectId).order("created_at"),
    supabase
      .from("source_versions")
      .select(COLUMNS)
      .eq("org_id", orgId)
      .eq("project_id", projectId)
      .order("version_number", { ascending: false }),
    supabase
      .from("processing_jobs")
      .select("id, subject_id, kind, status, error_code, runner")
      .eq("org_id", orgId)
      .eq("project_id", projectId)
      .in("kind", ["verify_upload", "extract_text"]),
    supabase
      .from("source_text_extractions")
      .select("source_version_id, status, page_count, pages_with_text, method")
      .eq("org_id", orgId)
      .eq("project_id", projectId),
  ]);
  if (e1 || e2 || e3 || e4) throw new Error("Could not load project files.");
  const jobBySubject = new Map((jobs ?? []).filter((j) => j.kind === "verify_upload").map((j) => [j.subject_id, j]));
  const extractJobBySubject = new Map((jobs ?? []).filter((j) => j.kind === "extract_text").map((j) => [j.subject_id, j]));
  const textBySubject = new Map((texts ?? []).map((t) => [t.source_version_id, t]));
  return (sources ?? []).map((s) => ({
    ...s,
    versions: (versions as SourceVersionRow[])
      .filter((v) => v.source_id === s.id)
      .map((v) => ({
        ...v,
        incomplete: v.status === "uploading" && Date.now() - new Date(v.created_at).getTime() > STALE_UPLOAD_MS,
        job: jobBySubject.get(v.id) ?? null,
        text: { outcome: textBySubject.get(v.id) ?? null, job: extractJobBySubject.get(v.id) ?? null },
      })),
  }));
}

export async function getVersion(orgId: string, projectId: string, versionId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("source_versions")
    .select(COLUMNS)
    .eq("org_id", orgId)
    .eq("project_id", projectId)
    .eq("id", versionId)
    .maybeSingle();
  if (error) throw new Error("Could not load file.");
  return data as SourceVersionRow | null;
}
