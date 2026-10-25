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

export type PageTextResult =
  | { status: "ok"; text: string; pageCount: number }
  | { status: "empty" | "needs_ocr" | "not_extracted" | "no_such_page" | "error" };

/**
 * Returns one page of a stored file's extracted text for the excerpt picker.
 * A server action (POST), so document text never appears in URLs or request logs.
 */
export async function getPageText(input: { projectId: string; versionId: string; page: number }): Promise<PageTextResult> {
  const m = await requireMembership();
  const p = z.object({ projectId: z.uuid(), versionId: z.uuid(), page: z.number().int().min(1).max(5000) }).safeParse(input);
  if (!p.success) return { status: "error" };
  const supabase = await createClient();
  const { data: ex } = await supabase
    .from("source_text_extractions")
    .select("status, page_count")
    .eq("org_id", m.orgId)
    .eq("project_id", p.data.projectId)
    .eq("source_version_id", p.data.versionId)
    .maybeSingle();
  if (!ex) return { status: "not_extracted" };
  if (ex.status === "needs_ocr") return { status: "needs_ocr" };
  if (p.data.page > ex.page_count) return { status: "no_such_page" };
  const { data: page } = await supabase
    .from("source_pages")
    .select("text")
    .eq("source_version_id", p.data.versionId)
    .eq("page_number", p.data.page)
    .maybeSingle();
  if (!page) return { status: "error" };
  if (!page.text.trim()) return { status: "empty" };
  return { status: "ok", text: page.text, pageCount: ex.page_count };
}
