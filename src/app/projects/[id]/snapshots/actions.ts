"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { hasRole, requireMembership } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type LockState = { status: "idle" | "error"; message?: string; note?: string };

function friendly(message: string): string {
  if (message.includes("stale")) return "The evidence changed after you opened this page. Nothing was locked. Reload to review the updated preview.";
  if (message.includes("identical to snapshot")) return "Nothing has changed since the last snapshot, so there is nothing new to lock.";
  if (message.includes("at least one approved fact")) return "A snapshot needs at least one approved fact.";
  if (message.includes("archived")) return "This project is archived.";
  if (message.includes("not allowed")) return "Only reviewers and admins can lock snapshots.";
  return "The snapshot could not be locked. Please try again.";
}

export async function lockSnapshot(_prev: LockState, fd: FormData): Promise<LockState> {
  const m = await requireMembership();
  const note = String(fd.get("note") ?? "");
  if (!hasRole(m, ["admin", "reviewer"])) return { status: "error", message: "Only reviewers and admins can lock snapshots.", note };
  const p = z
    .object({ project_id: z.uuid(), fingerprint: z.string().regex(/^[0-9a-f]{64}$/), note: z.string().max(2000) })
    .safeParse({ project_id: fd.get("project_id"), fingerprint: fd.get("fingerprint"), note });
  if (!p.success) return { status: "error", message: "This page is out of date. Reload it.", note };

  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("lock_evidence_snapshot", { p_project_id: p.data.project_id, p_expected_fingerprint: p.data.fingerprint, p_note: p.data.note })
    .single<{ snapshot_id: string; snapshot_number: number }>();
  if (error || !data) {
    console.warn("[snapshots] lock failed", { code: error?.code });
    return { status: "error", message: friendly(error?.message ?? ""), note };
  }
  redirect(`/projects/${p.data.project_id}/snapshots/${data.snapshot_number}`);
}
