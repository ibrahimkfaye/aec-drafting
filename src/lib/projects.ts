import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Member } from "@/lib/members";
export type { Member } from "@/lib/members";
export { eligibleReviewers, memberLabel } from "@/lib/members";

/**
 * Project reads. Every query runs AS THE SIGNED-IN USER, so row-level security
 * limits results to the user's own firm even if a filter here were wrong.
 */
export type ProjectRow = {
  id: string;
  org_id: string;
  name: string;
  client_name: string;
  location: string;
  document_type: string;
  scope_instructions: string;
  assigned_reviewer_id: string | null;
  status: "active" | "archived";
  created_by: string;
  created_at: string;
  updated_at: string;
  row_version: number;
};


const PROJECT_COLUMNS =
  "id, org_id, name, client_name, location, document_type, scope_instructions, assigned_reviewer_id, status, created_by, created_at, updated_at, row_version";

export async function listProjects(orgId: string): Promise<ProjectRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select(PROJECT_COLUMNS)
    .eq("org_id", orgId)
    .order("status", { ascending: true })
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) throw new Error("Could not load projects.");
  return data as ProjectRow[];
}

export async function getProject(orgId: string, id: string): Promise<ProjectRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select(PROJECT_COLUMNS)
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("Could not load project.");
  return data as ProjectRow | null;
}

export async function listMembers(orgId: string): Promise<Member[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("memberships")
    .select("user_id, display_name, email, role")
    .eq("org_id", orgId)
    .order("display_name");
  if (error) throw new Error("Could not load firm members.");
  return data as Member[];
}

export type AuditRow = {
  id: number;
  action: string;
  actor_id: string | null;
  actor_type: "user" | "system";
  details: { changed_fields?: string[]; row_version?: number };
  occurred_at: string;
};

export async function listProjectAudit(orgId: string, projectId: string): Promise<AuditRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("audit_events")
    .select("id, action, actor_id, actor_type, details, occurred_at")
    .eq("org_id", orgId)
    .eq("project_id", projectId)
    .order("id", { ascending: false })
    .limit(50);
  if (error) throw new Error("Could not load project history.");
  return data as AuditRow[];
}
