"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { hasRole, requireMembership } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendlyFactError } from "@/lib/fact-schema";

export type SimpleState = {
  status: "idle" | "error" | "done";
  message?: string;
  /** What the user entered, so a refused submit doesn't wipe the form. */
  values?: { description?: string; note?: string; choice?: string; fact_ids?: string[] };
};

const keep = (fd: FormData): SimpleState["values"] => ({
  description: String(fd.get("description") ?? ""),
  note: String(fd.get("note") ?? ""),
  choice: String(fd.get("fact_revision_id") ?? fd.get("prevailing_fact_id") ?? ""),
  fact_ids: fd.getAll("fact_ids").map(String),
});

const RAISERS = ["admin", "author", "reviewer"] as const;
const CLOSERS = ["admin", "reviewer"] as const;
const description = z
  .string()
  .trim()
  .min(1, "Describe it in a sentence.")
  .max(1000, "Keep it to 1,000 characters or fewer.");

async function run(projectId: string, rpc: string, args: Record<string, unknown>): Promise<SimpleState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc(rpc, args);
  if (error) {
    console.warn(`[evidence] ${rpc} failed`, { code: error.code });
    return { status: "error", message: friendlyFactError(error.message) };
  }
  revalidatePath(`/projects/${projectId}/evidence`);
  return { status: "done" };
}

export async function raiseGap(prev: SimpleState, fd: FormData): Promise<SimpleState> {
  const r = await raiseGapInner(prev, fd);
  return r.status === "error" ? { ...r, values: keep(fd) } : r;
}

async function raiseGapInner(_prev: SimpleState, fd: FormData): Promise<SimpleState> {
  const m = await requireMembership();
  if (!hasRole(m, [...RAISERS])) return { status: "error", message: "Your role cannot raise gaps." };
  const p = z.object({ project_id: z.uuid(), description }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { status: "error", message: p.error.issues[0]?.message ?? "Check the form." };
  return run(p.data.project_id, "create_gap", { p_project_id: p.data.project_id, p_description: p.data.description });
}

export async function closeGap(prev: SimpleState, fd: FormData): Promise<SimpleState> {
  const r = await closeGapInner(prev, fd);
  return r.status === "error" ? { ...r, values: keep(fd) } : r;
}

async function closeGapInner(_prev: SimpleState, fd: FormData): Promise<SimpleState> {
  const m = await requireMembership();
  if (!hasRole(m, [...CLOSERS])) return { status: "error", message: "Only reviewers and admins can close gaps." };
  const p = z
    .object({
      project_id: z.uuid(),
      gap_id: z.uuid(),
      decision: z.enum(["resolve", "dismiss"]),
      fact_revision_id: z.union([z.uuid(), z.literal("")]).optional(),
      note: z.string().max(2000).optional(),
    })
    .safeParse(Object.fromEntries(fd));
  if (!p.success) return { status: "error", message: "This form is out of date. Reload the page." };
  if (p.data.decision === "resolve" && !p.data.fact_revision_id) {
    return { status: "error", message: "Choose the approved fact that fills this gap." };
  }
  return run(p.data.project_id, "close_gap", {
    p_gap_id: p.data.gap_id,
    p_decision: p.data.decision,
    p_fact_revision_id: p.data.decision === "resolve" ? p.data.fact_revision_id : null,
    p_note: p.data.note ?? "",
  });
}

export async function raiseConflict(prev: SimpleState, fd: FormData): Promise<SimpleState> {
  const r = await raiseConflictInner(prev, fd);
  return r.status === "error" ? { ...r, values: keep(fd) } : r;
}

async function raiseConflictInner(_prev: SimpleState, fd: FormData): Promise<SimpleState> {
  const m = await requireMembership();
  if (!hasRole(m, [...RAISERS])) return { status: "error", message: "Your role cannot raise conflicts." };
  const p = z
    .object({ project_id: z.uuid(), description, fact_ids: z.array(z.uuid()).max(20) })
    .safeParse({ project_id: fd.get("project_id"), description: fd.get("description"), fact_ids: fd.getAll("fact_ids") });
  if (!p.success) return { status: "error", message: p.error.issues[0]?.message ?? "Check the form." };
  if (new Set(p.data.fact_ids).size < 2) return { status: "error", message: "Choose at least two different facts." };
  return run(p.data.project_id, "create_conflict", {
    p_project_id: p.data.project_id,
    p_description: p.data.description,
    p_fact_ids: p.data.fact_ids,
  });
}

export async function resolveConflict(prev: SimpleState, fd: FormData): Promise<SimpleState> {
  const r = await resolveConflictInner(prev, fd);
  return r.status === "error" ? { ...r, values: keep(fd) } : r;
}

async function resolveConflictInner(_prev: SimpleState, fd: FormData): Promise<SimpleState> {
  const m = await requireMembership();
  if (!hasRole(m, [...CLOSERS])) return { status: "error", message: "Only reviewers and admins can resolve conflicts." };
  const p = z
    .object({
      project_id: z.uuid(),
      conflict_id: z.uuid(),
      prevailing_fact_id: z.union([z.uuid(), z.literal("")]).optional(),
      note: z.string().max(2000).optional(),
    })
    .safeParse(Object.fromEntries(fd));
  if (!p.success) return { status: "error", message: "This form is out of date. Reload the page." };
  if (!p.data.prevailing_fact_id) return { status: "error", message: "Choose which fact stands." };
  return run(p.data.project_id, "resolve_conflict", {
    p_conflict_id: p.data.conflict_id,
    p_prevailing_fact_id: p.data.prevailing_fact_id,
    p_note: p.data.note ?? "",
  });
}
