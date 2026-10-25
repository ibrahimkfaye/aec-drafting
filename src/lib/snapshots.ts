import "server-only";
import { createClient } from "@/lib/supabase/server";

export type SnapshotItem = {
  item_type: "fact" | "excluded" | "gap";
  fact_id: string | null;
  fact_revision_id: string | null;
  gap_id: string | null;
  exclusion_reason: "open_conflict" | "lost_conflict" | null;
};

export type SnapshotPreview = { fingerprint: string; pendingReview: number; items: SnapshotItem[] };

export type Snapshot = {
  id: string;
  snapshot_number: number;
  locked_by: string;
  locked_at: string;
  note: string | null;
  fact_count: number;
  excluded_count: number;
  gap_count: number;
  fingerprint: string;
};

const COLUMNS = "id, snapshot_number, locked_by, locked_at, note, fact_count, excluded_count, gap_count, fingerprint";

export async function previewSnapshot(projectId: string): Promise<SnapshotPreview> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("preview_evidence_snapshot", { p_project_id: projectId });
  if (error || !data?.length) throw new Error("Could not build the snapshot preview.");
  const rows = data as (Omit<SnapshotItem, "item_type"> & { item_type: string; fingerprint: string; pending_review: number })[];
  return {
    fingerprint: rows[0].fingerprint,
    pendingReview: rows[0].pending_review,
    items: rows.filter((r) => r.item_type !== "summary") as unknown as SnapshotItem[],
  };
}

export async function listSnapshots(orgId: string, projectId: string): Promise<Snapshot[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("evidence_snapshots")
    .select(COLUMNS)
    .eq("org_id", orgId)
    .eq("project_id", projectId)
    .order("snapshot_number", { ascending: false });
  if (error) throw new Error("Could not load snapshots.");
  return data as Snapshot[];
}

export async function getSnapshot(orgId: string, projectId: string, number: number) {
  const supabase = await createClient();
  const { data: snap, error } = await supabase
    .from("evidence_snapshots")
    .select(COLUMNS)
    .eq("org_id", orgId)
    .eq("project_id", projectId)
    .eq("snapshot_number", number)
    .maybeSingle();
  if (error) throw new Error("Could not load snapshot.");
  if (!snap) return null;
  const { data: items, error: e2 } = await supabase
    .from("evidence_snapshot_items")
    .select("item_type, fact_id, fact_revision_id, gap_id, exclusion_reason")
    .eq("snapshot_id", snap.id);
  if (e2) throw new Error("Could not load snapshot items.");
  return { snapshot: snap as Snapshot, items: items as SnapshotItem[] };
}

export const EXCLUSION_TEXT = {
  open_conflict: "In an open conflict",
  lost_conflict: "Did not prevail in a resolved conflict",
} as const;
