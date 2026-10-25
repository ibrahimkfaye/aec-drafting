/** Pure helper (no server access) so it can be unit-tested. */
export type ConflictLike = { status: "open" | "resolved"; prevailing_fact_id: string | null; fact_ids: string[] };

/** Which facts are in an open conflict, and which lost a resolved one (excluded from snapshots). */
export function conflictFlags(conflicts: ConflictLike[]) {
  const inOpen = new Set<string>();
  const lost = new Set<string>();
  for (const c of conflicts) {
    for (const f of c.fact_ids) {
      if (c.status === "open") inOpen.add(f);
      else if (f !== c.prevailing_fact_id) lost.add(f);
    }
  }
  return { inOpen, lost };
}
