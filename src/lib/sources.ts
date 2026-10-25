import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { BlockReason, DetectedType } from "@/lib/files";

export const BUCKET = "project-files";

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
};

const STALE_UPLOAD_MS = 2 * 60 * 60 * 1000; // signed upload URLs expire after 2 hours

export type SourceWithVersions = { id: string; title: string; created_at: string; versions: SourceVersionRow[] };

const COLUMNS =
  "id, source_id, version_number, original_filename, byte_size, detected_type, status, block_reason, scan_status, uploaded_by, created_at, storage_path";

export async function listSources(orgId: string, projectId: string): Promise<SourceWithVersions[]> {
  const supabase = await createClient();
  const [{ data: sources, error: e1 }, { data: versions, error: e2 }] = await Promise.all([
    supabase.from("sources").select("id, title, created_at").eq("org_id", orgId).eq("project_id", projectId).order("created_at"),
    supabase
      .from("source_versions")
      .select(COLUMNS)
      .eq("org_id", orgId)
      .eq("project_id", projectId)
      .order("version_number", { ascending: false }),
  ]);
  if (e1 || e2) throw new Error("Could not load project files.");
  return (sources ?? []).map((s) => ({
    ...s,
    versions: (versions as SourceVersionRow[])
      .filter((v) => v.source_id === s.id)
      .map((v) => ({
        ...v,
        incomplete: v.status === "uploading" && Date.now() - new Date(v.created_at).getTime() > STALE_UPLOAD_MS,
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
