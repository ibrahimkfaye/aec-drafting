import "server-only";
import { createClient } from "@/lib/supabase/server";
import { matchExcerpt, type ExcerptMatch } from "@/lib/excerpt";

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
  /** Whether the excerpt appears in the extracted text of the cited page (or file). */
  match: ExcerptMatch;
  /** True when that text came from OCR (less reliable than a text layer). */
  ocrText: boolean;
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
  // Load only the extracted pages that citations point at (the API caps rows per request).
  const pagesByVersion = new Map<string, Map<number, string>>();
  const ocrVersions = new Set<string>();
  const keep = (rows: { source_version_id: string; page_number: number; text: string; origin: string }[] | null) => {
    for (const pg of rows ?? []) {
      if (pg.origin === "ocr") ocrVersions.add(pg.source_version_id);
      const m = pagesByVersion.get(pg.source_version_id) ?? new Map<number, string>();
      m.set(pg.page_number, pg.text);
      pagesByVersion.set(pg.source_version_id, m);
    }
  };
  const paged = cits.data.filter((c) => c.page != null);
  const wholeFile = [...new Set(cits.data.filter((c) => c.page == null).map((c) => c.source_version_id))];
  if (paged.length) {
    const { data, error: pErr } = await supabase
      .from("source_pages")
      .select("source_version_id, page_number, text, origin")
      .in("source_version_id", [...new Set(paged.map((c) => c.source_version_id))])
      .in("page_number", [...new Set(paged.map((c) => c.page as number))]);
    if (pErr) throw new Error("Could not load extracted text.");
    keep(data);
  }
  for (const versionId of wholeFile) {
    for (let from = 0; from < 5000; from += 500) {
      const { data, error: pErr } = await supabase
        .from("source_pages")
        .select("source_version_id, page_number, text, origin")
        .eq("source_version_id", versionId)
        .order("page_number")
        .range(from, from + 499);
      if (pErr) throw new Error("Could not load extracted text.");
      keep(data);
      if (!data || data.length < 500) break;
    }
  }
  const textFor = (versionId: string, page: number | null): string[] | null => {
    const m = pagesByVersion.get(versionId);
    if (!m) return null;
    if (page == null) return [...m.values()];
    const t = m.get(page);
    return t == null ? null : [t];
  };
  const citationsByRevision = new Map<string, Citation[]>();
  for (const c of cits.data) {
    const v = versionInfo.get(c.source_version_id);
    const list = citationsByRevision.get(c.fact_revision_id) ?? [];
    list.push({
      ...c,
      filename: v?.original_filename ?? "Unknown file",
      version_number: v?.version_number ?? 0,
      match: matchExcerpt(c.excerpt, textFor(c.source_version_id, c.page)),
      ocrText: ocrVersions.has(c.source_version_id),
    });
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
