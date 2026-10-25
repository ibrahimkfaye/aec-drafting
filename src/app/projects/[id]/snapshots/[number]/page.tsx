import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { requireMembership } from "@/lib/auth";
import { getProject, listMembers, memberLabel } from "@/lib/projects";
import { listFacts } from "@/lib/facts";
import { listGaps } from "@/lib/gaps-conflicts";
import { getSnapshot } from "@/lib/snapshots";
import { formatUtc } from "@/lib/format";
import { PageShell } from "@/app/page-shell";
import { SnapshotContents, revisionMap } from "../snapshot-contents";

type Props = { params: Promise<{ id: string; number: string }> };

export default function SnapshotPage({ params }: Props) {
  return (
    <Suspense fallback={<PageShell>Loading…</PageShell>}>
      <SnapshotView params={params} />
    </Suspense>
  );
}

async function SnapshotView({ params }: Props) {
  const { id, number } = await params;
  const n = z.coerce.number().int().positive().safeParse(number);
  if (!z.uuid().safeParse(id).success || !n.success) notFound();
  const m = await requireMembership();
  const project = await getProject(m.orgId, id);
  if (!project) notFound();
  const found = await getSnapshot(m.orgId, id, n.data);
  if (!found) notFound();
  const [facts, gaps, members] = await Promise.all([listFacts(m.orgId, id), listGaps(m.orgId, id), listMembers(m.orgId)]);
  const s = found.snapshot;

  return (
    <PageShell back={{ href: `/projects/${id}/snapshots`, label: "Evidence snapshots" }}>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Snapshot {s.snapshot_number}</h1>
        <p className="w-fit rounded bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-900" data-testid="locked-badge">
          Locked — this snapshot cannot change
        </p>
        <p className="text-sm text-zinc-600">
          Locked by <span data-testid="locked-by">{memberLabel(members, s.locked_by)}</span> · {formatUtc(s.locked_at)}
        </p>
        {s.note && <p className="text-sm text-zinc-700">Note: {s.note}</p>}
        <p className="font-mono text-xs text-zinc-500" title="Fingerprint of the exact contents">
          Fingerprint {s.fingerprint.slice(0, 16)}…
        </p>
      </header>
      <div data-testid="snapshot-view">
        <SnapshotContents items={found.items} revisions={revisionMap(facts)} gaps={new Map(gaps.map((g) => [g.id, g]))} />
      </div>
    </PageShell>
  );
}
