import type { FactRevision } from "@/lib/facts";
import type { Gap } from "@/lib/gaps-conflicts";
import { EXCLUSION_TEXT, type SnapshotItem } from "@/lib/snapshots";

/** Renders snapshot (or preview) items by their exact, immutable revision ids. */
export function SnapshotContents({
  items,
  revisions,
  gaps,
}: {
  items: SnapshotItem[];
  revisions: Map<string, FactRevision>;
  gaps: Map<string, Gap>;
}) {
  const facts = items.filter((i) => i.item_type === "fact");
  const excluded = items.filter((i) => i.item_type === "excluded");
  const open = items.filter((i) => i.item_type === "gap");
  return (
    <div className="flex flex-col gap-5">
      <section data-testid="snapshot-facts">
        <h3 className="font-semibold">Approved facts ({facts.length})</h3>
        <ol className="mt-2 flex flex-col gap-3">
          {facts.map((i) => {
            const r = revisions.get(i.fact_revision_id!);
            return (
              <li key={i.fact_revision_id} className="border-l-2 border-emerald-300 pl-3 text-sm" data-testid="snapshot-fact">
                <p className="font-medium">{r?.statement ?? "Unknown fact"}</p>
                {r?.citations.map((c) => (
                  <p key={c.id} className="text-zinc-600">
                    {c.filename} · v{c.version_number}
                    {c.page ? ` · p. ${c.page}` : ""}
                    {c.section ? ` · ${c.section}` : ""} — “{c.excerpt}”
                  </p>
                ))}
                <p className="text-xs text-zinc-500">revision {r?.revision_number}</p>
              </li>
            );
          })}
        </ol>
      </section>
      <section data-testid="snapshot-gaps">
        <h3 className="font-semibold">Information needed ({open.length})</h3>
        {open.length === 0 ? (
          <p className="text-sm text-zinc-500">No open gaps.</p>
        ) : (
          <ul className="mt-2 list-disc pl-5 text-sm">
            {open.map((i) => (
              <li key={i.gap_id} data-testid="snapshot-gap">
                {gaps.get(i.gap_id!)?.description ?? "Unknown gap"}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section data-testid="snapshot-excluded">
        <h3 className="font-semibold">Approved but left out ({excluded.length})</h3>
        {excluded.length === 0 ? (
          <p className="text-sm text-zinc-500">None.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {excluded.map((i) => (
              <li key={i.fact_revision_id} data-testid="snapshot-excluded-fact">
                <span className="text-zinc-700">{revisions.get(i.fact_revision_id!)?.statement ?? "Unknown fact"}</span>
                <span className="ml-2 rounded bg-red-50 px-2 py-0.5 text-xs text-red-900">{EXCLUSION_TEXT[i.exclusion_reason!]}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function revisionMap(facts: { current: FactRevision; history: FactRevision[] }[]) {
  return new Map(facts.flatMap((f) => [f.current, ...f.history]).map((r) => [r.id, r]));
}
