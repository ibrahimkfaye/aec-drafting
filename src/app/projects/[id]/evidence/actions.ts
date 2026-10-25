"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { hasRole, requireMembership } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  factFieldErrors,
  friendlyFactError,
  parseFactForm,
  readFactForm,
  type FactFormField,
} from "@/lib/fact-schema";

export type FactFormState = {
  status: "idle" | "error" | "saved";
  message?: string;
  fieldErrors?: Partial<Record<FactFormField, string>>;
  values?: Record<FactFormField, string>;
};

export type ReviewState = { status: "idle" | "error" | "done"; message?: string; note?: string };

const PROPOSERS = ["admin", "author", "reviewer"] as const;
const REVIEWERS = ["admin", "reviewer"] as const;

/** Adds a new candidate fact (form includes project_id) or a new revision (form includes fact_id + based_on). */
export async function saveFact(_prev: FactFormState, formData: FormData): Promise<FactFormState> {
  const m = await requireMembership();
  const values = readFactForm(formData);
  if (!hasRole(m, [...PROPOSERS])) return { status: "error", message: "Your role cannot propose facts.", values };

  const ids = z
    .object({ project_id: z.uuid(), fact_id: z.uuid().optional(), based_on: z.uuid().optional() })
    .safeParse({
      project_id: formData.get("project_id"),
      fact_id: formData.get("fact_id") || undefined,
      based_on: formData.get("based_on") || undefined,
    });
  if (!ids.success) return { status: "error", message: "This form is out of date. Reload the page.", values };

  const parsed = parseFactForm(values);
  if (!parsed.success) return { status: "error", fieldErrors: factFieldErrors(parsed.error), values };
  const citations = [
    {
      source_version_id: parsed.data.citation.source_version_id,
      page: parsed.data.citation.page,
      section: parsed.data.citation.section,
      excerpt: parsed.data.citation.excerpt,
    },
  ];

  const supabase = await createClient();
  const { error } = ids.data.fact_id
    ? await supabase.rpc("revise_fact", {
        p_fact_id: ids.data.fact_id,
        p_based_on_revision_id: ids.data.based_on,
        p_statement: parsed.data.statement,
        p_citations: citations,
      })
    : await supabase.rpc("create_fact", {
        p_project_id: ids.data.project_id,
        p_statement: parsed.data.statement,
        p_citations: citations,
      });
  if (error) {
    console.warn("[facts] save failed", { code: error.code });
    return { status: "error", message: friendlyFactError(error.message), values };
  }
  revalidatePath(`/projects/${ids.data.project_id}/evidence`);
  return { status: "saved" };
}

export async function reviewFact(_prev: ReviewState, formData: FormData): Promise<ReviewState> {
  const m = await requireMembership();
  if (!hasRole(m, [...REVIEWERS])) return { status: "error", message: "Only reviewers and admins can review facts." };
  const parsed = z
    .object({
      project_id: z.uuid(),
      revision_id: z.uuid(),
      decision: z.enum(["approve", "reject"]),
      note: z.string().max(2000).default(""),
    })
    .safeParse({
      project_id: formData.get("project_id"),
      revision_id: formData.get("revision_id"),
      decision: formData.get("decision"),
      note: formData.get("note") ?? "",
    });
  if (!parsed.success) return { status: "error", message: "This form is out of date. Reload the page." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("review_fact_revision", {
    p_revision_id: parsed.data.revision_id,
    p_decision: parsed.data.decision,
    p_note: parsed.data.note,
  });
  if (error) {
    console.warn("[facts] review failed", { code: error.code });
    return { status: "error", message: friendlyFactError(error.message), note: parsed.data.note };
  }
  revalidatePath(`/projects/${parsed.data.project_id}/evidence`);
  return { status: "done" };
}
