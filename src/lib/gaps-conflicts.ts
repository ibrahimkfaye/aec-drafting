import "server-only";
import { createClient } from "@/lib/supabase/server";

export type Gap = {
  id: string;
  description: string;
  status: "open" | "resolved" | "dismissed";
  created_by: string;
  created_at: string;
  closed_by: string | null;
  closed_at: string | null;
  closing_note: string | null;
  resolving_fact_revision_id: string | null;
  self_closed: boolean;
};

export type Conflict = {
  id: string;
  description: string;
  status: "open" | "resolved";
  created_by: string;
  created_at: string;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  prevailing_fact_id: string | null;
  self_closed: boolean;
  fact_ids: string[];
};

export async function listGaps(orgId: string, projectId: string): Promise<Gap[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("gaps")
    .select(
      "id, description, status, created_by, created_at, closed_by, closed_at, closing_note, resolving_fact_revision_id, self_closed",
    )
    .eq("org_id", orgId)
    .eq("project_id", projectId)
    .order("created_at");
  if (error) throw new Error("Could not load gaps.");
  return data as Gap[];
}

export async function listConflicts(orgId: string, projectId: string): Promise<Conflict[]> {
  const supabase = await createClient();
  const [c, cf] = await Promise.all([
    supabase
      .from("conflicts")
      .select("id, description, status, created_by, created_at, resolved_by, resolved_at, resolution_note, prevailing_fact_id, self_closed")
      .eq("org_id", orgId)
      .eq("project_id", projectId)
      .order("created_at"),
    supabase.from("conflict_facts").select("conflict_id, fact_id").eq("org_id", orgId).eq("project_id", projectId),
  ]);
  if (c.error || cf.error) throw new Error("Could not load conflicts.");
  return (c.data as Omit<Conflict, "fact_ids">[]).map((x) => ({
    ...x,
    fact_ids: cf.data.filter((r) => r.conflict_id === x.id).map((r) => r.fact_id),
  }));
}

export { conflictFlags } from "@/lib/conflict-flags";
