"use server";

import { redirect } from "next/navigation";
import { hasRole, requireMembership } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  fieldErrors,
  projectFieldsSchema,
  projectRefSchema,
  readProjectForm,
  type ProjectFieldName,
} from "@/lib/project-schema";
import { eligibleReviewers, listMembers } from "@/lib/projects";

export type ProjectFormState = {
  status: "idle" | "error" | "conflict";
  message?: string;
  fieldErrors?: Partial<Record<ProjectFieldName, string>>;
  /** What the user typed, so nothing is lost when a save is rejected. */
  values?: Record<ProjectFieldName, string>;
};

const EDITOR_ROLES = ["admin", "author"] as const;
const NOT_ALLOWED = "Your role cannot create or edit projects. Ask an admin or author.";
const CONFLICT =
  "Someone else changed this project after you opened it. Your edits were NOT saved. Reload the page to see the latest version, then re-apply your changes.";

/** Validates fields and confirms the reviewer belongs to this firm with an eligible role. */
async function validate(orgId: string, raw: Record<ProjectFieldName, string>) {
  const parsed = projectFieldsSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, fieldErrors: fieldErrors(parsed.error) };
  const reviewerId = parsed.data.assigned_reviewer_id;
  if (reviewerId) {
    const reviewers = eligibleReviewers(await listMembers(orgId));
    if (!reviewers.some((r) => r.user_id === reviewerId)) {
      return {
        ok: false as const,
        fieldErrors: { assigned_reviewer_id: "Reviewer must be a reviewer or admin in your firm." },
      };
    }
  }
  return { ok: true as const, data: parsed.data };
}

export async function createProject(_prev: ProjectFormState, formData: FormData): Promise<ProjectFormState> {
  const m = await requireMembership();
  const values = readProjectForm(formData);
  if (!hasRole(m, [...EDITOR_ROLES])) return { status: "error", message: NOT_ALLOWED, values };

  const v = await validate(m.orgId, values);
  if (!v.ok) return { status: "error", fieldErrors: v.fieldErrors, values };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .insert({ ...v.data, org_id: m.orgId, created_by: m.user.id })
    .select("id")
    .single();
  if (error || !data) {
    console.warn("[projects] create failed", { code: error?.code });
    return { status: "error", message: "The project could not be saved. Please try again.", values };
  }
  redirect(`/projects/${data.id}`);
}

export async function updateProject(_prev: ProjectFormState, formData: FormData): Promise<ProjectFormState> {
  const m = await requireMembership();
  const values = readProjectForm(formData);
  if (!hasRole(m, [...EDITOR_ROLES])) return { status: "error", message: NOT_ALLOWED, values };

  const ref = projectRefSchema.safeParse({ id: formData.get("id"), row_version: formData.get("row_version") });
  if (!ref.success) return { status: "error", message: "This form is out of date. Reload the page.", values };

  const v = await validate(m.orgId, values);
  if (!v.ok) return { status: "error", fieldErrors: v.fieldErrors, values };

  const result = await versionedUpdate(m.orgId, ref.data.id, ref.data.row_version, v.data);
  if (result === "conflict") return { status: "conflict", message: CONFLICT, values };
  if (result === "missing") return { status: "error", message: "Project not found.", values };
  if (result === "error") return { status: "error", message: "The project could not be saved. Please try again.", values };
  redirect(`/projects/${ref.data.id}`);
}

export type StatusFormState = { status: "idle" | "error" | "conflict"; message?: string };

export async function setProjectStatus(_prev: StatusFormState, formData: FormData): Promise<StatusFormState> {
  const m = await requireMembership();
  if (!hasRole(m, [...EDITOR_ROLES])) return { status: "error", message: NOT_ALLOWED };

  const ref = projectRefSchema.safeParse({ id: formData.get("id"), row_version: formData.get("row_version") });
  const next = formData.get("next_status");
  if (!ref.success || (next !== "active" && next !== "archived")) {
    return { status: "error", message: "This form is out of date. Reload the page." };
  }
  const result = await versionedUpdate(m.orgId, ref.data.id, ref.data.row_version, { status: next });
  if (result === "conflict") return { status: "conflict", message: CONFLICT };
  if (result !== "ok") return { status: "error", message: "The status could not be changed." };
  redirect(`/projects/${ref.data.id}`);
}

/**
 * Optimistic concurrency: the UPDATE only matches if the row still has the
 * version the user loaded. The database bumps row_version on every write, so
 * two people saving the same version cannot both succeed (atomic in Postgres).
 */
async function versionedUpdate(
  orgId: string,
  id: string,
  expectedVersion: number,
  values: Record<string, unknown>,
): Promise<"ok" | "conflict" | "missing" | "error"> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .update(values)
    .eq("org_id", orgId)
    .eq("id", id)
    .eq("row_version", expectedVersion)
    .select("id")
    .maybeSingle();
  if (error) {
    console.warn("[projects] update failed", { code: error.code });
    return "error";
  }
  if (data) return "ok";
  const { data: current } = await supabase.from("projects").select("id").eq("org_id", orgId).eq("id", id).maybeSingle();
  return current ? "conflict" : "missing";
}
