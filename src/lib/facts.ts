import "server-only";
import { createClient } from "@/lib/supabase/server";

export type FactStatus = "candidate" | "approved" | "rejected" | "superseded";

export type Citation = {
  id: string;
  source_version_id: string;
  page: number | null;
  section: string | null;
  excerpt: string;
  /** Joined from source_versions for display. */
  filename: string;
  version_number: number;
};

export type FactRevision = {
  id: string;
  fact_id: string;
  revision_number: number;
  statement: string;
  status: FactStatus;
  created_by: string;
  created_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  self_approved: boolean;
  citations: Citation[];
};

export type FactView = { id: string; current: FactRevision; history: FactRevision[] };

export type CitableVersion = { id: string; label: string };

export async function listFacts(orgId: string, projectId: string): Promise<FactView[]> {
  const supabase = await createClient();
  const [revs, cits, versions] = await Promise.all([
    supabase
      .from("fact_revisions")
      .select(
        "id, fact_id, revision_number, statement, status, created_by, created_at, reviewed_by, reviewed_at, review_note, self_approved",
      )
      .eq("org_id", orgId)
      .eq("project_id", projectId)
      .order("revision_number", { ascending: false }),
    supabase
      .from("fact_citations")
      .select("id, fact_revision_id, source_version_id, page, section, excerpt")
      .eq("org_id", orgId)
      .eq("project_id", projectId),
    supabase.from("source_versions").select("id, original_filename, version_number").eq("org_id", orgId).eq("project_id", projectId),
  ]);
  if (revs.error || cits.error || versions.error) throw new Error("Could not load evidence.");

  const versionInfo = new Map(versions.data.map((v) => [v.id, v]));
  const citationsByRevision = new Map<string, Citation[]>();
  for (const c of cits.data) {
    const v = versionInfo.get(c.source_version_id);
    const list = citationsByRevision.get(c.fact_revision_id) ?? [];
    list.push({ ...c, filename: v?.original_filename ?? "Unknown file", version_number: v?.version_number ?? 0 });
    citationsByRevision.set(c.fact_revision_id, list);
  }

  const byFact = new Map<string, FactRevision[]>();
  for (const r of revs.data as Omit<FactRevision, "citations">[]) {
    const list = byFact.get(r.fact_id) ?? [];
    list.push({ ...r, citations: citationsByRevision.get(r.id) ?? [] });
    byFact.set(r.fact_id, list);
  }
  return [...byFact.entries()]
    .map(([id, list]) => ({ id, current: list[0], history: list.slice(1) }))
    .sort((a, b) => a.current.created_at.localeCompare(b.current.created_at));
}

export async function listCitableVersions(orgId: string, projectId: string): Promise<CitableVersion[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("source_versions")
    .select("id, original_filename, version_number")
    .eq("org_id", orgId)
    .eq("project_id", projectId)
    .eq("status", "stored")
    .order("created_at", { ascending: false });
  if (error) throw new Error("Could not load files.");
  return data.map((v) => ({ id: v.id, label: `${v.original_filename} (v${v.version_number})` }));
}
