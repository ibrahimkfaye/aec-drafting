import "server-only";
import { createClient } from "@/lib/supabase/server";
import { AUDIT_GROUPS, type AuditDetails, type AuditGroup } from "@/lib/format";

export type AuditEvent = {
  id: number;
  project_id: string | null;
  actor_id: string | null;
  actor_type: "user" | "system";
  action: string;
  entity_type: string;
  details: AuditDetails;
  occurred_at: string;
};

export const PAGE_SIZE = 50;

/** Firm-wide history, newest first, read through row-level security as the user. */
export async function listFirmAudit(
  orgId: string,
  filters: { projectId?: string; actorId?: string; group?: AuditGroup; before?: number },
): Promise<{ events: AuditEvent[]; hasMore: boolean }> {
  const supabase = await createClient();
  let q = supabase
    .from("audit_events")
    .select("id, project_id, actor_id, actor_type, action, entity_type, details, occurred_at")
    .eq("org_id", orgId)
    .order("id", { ascending: false })
    .limit(PAGE_SIZE + 1);
  if (filters.projectId) q = q.eq("project_id", filters.projectId);
  if (filters.actorId) q = q.eq("actor_id", filters.actorId);
  if (filters.group) q = q.like("action", `${AUDIT_GROUPS[filters.group].prefix}%`);
  if (filters.before) q = q.lt("id", filters.before);
  const { data, error } = await q;
  if (error) throw new Error("Could not load history.");
  const rows = data as AuditEvent[];
  return { events: rows.slice(0, PAGE_SIZE), hasMore: rows.length > PAGE_SIZE };
}
