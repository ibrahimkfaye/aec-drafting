import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { hasRole, requireMembership } from "@/lib/auth";
import { getProject, listMembers, memberLabel } from "@/lib/projects";
import { listFacts } from "@/lib/facts";
import { listGaps } from "@/lib/gaps-conflicts";
import { listSnapshots, previewSnapshot } from "@/lib/snapshots";
import { formatUtc } from "@/lib/format";
import { PageShell } from "@/app/page-shell";
import { LockForm } from "./lock-form";
import { SnapshotContents, revisionMap } from "./snapshot-contents";

type Props = { params: Promise<{ id: string }> };

export default function SnapshotsPage({ params }: Props) {
  return (
    <Suspense fallback={<PageShell>Loading…</PageShell>}>
      <Snapshots params={params} />
    </Suspense>
  );
}

async function Snapshots({ params }: Props) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const m = await requireMembership();
  const project = await getProject(m.orgId, id);
  if (!project) notFound();
  const [preview, snapshots, facts, gaps, members] = await Promise.all([
    previewSnapshot(id),
    listSnapshots(m.orgId, id),
    listFacts(m.orgId, id),
    listGaps(m.orgId, id),
    listMembers(m.orgId),
  ]);
  const canLock = project.status === "active" && hasRole(m, ["admin", "reviewer"]);
  const nextNumber = (snapshots[0]?.snapshot_number ?? 0) + 1;
  const unchanged = snapshots[0]?.fingerprint === preview.fingerprint;
  const factCount = preview.items.filter((i) => i.item_type === "fact").length;

  return (
    <PageShell back={{ href: `/projects/${id}`, label: project.name }}>
      <header>
        <h1 className="text-2xl font-semibold">Evidence snapshots</h1>
        <p className="text-sm text-zinc-600">
          A snapshot locks the approved evidence at one moment. Drafts will be written only from a locked snapshot.
        </p>
      </header>

      <section className="flex flex-col gap-4 rounded border border-zinc-200 p-4" data-testid="snapshot-preview">
        <h2 className="text-lg font-semibold">Preview of snapshot {nextNumber}</h2>
        {preview.pendingReview > 0 && (
          <p className="text-sm text-amber-900" data-testid="pending-note">
            {preview.pendingReview} fact{preview.pendingReview === 1 ? " is" : "s are"} still awaiting review and will not be
            included. <Link className="underline" href={`/projects/${id}/evidence`}>Go to evidence review</Link>.
          </p>
        )}
        {unchanged && (
          <p className="text-sm text-zinc-600" data-testid="unchanged-note">
            Nothing has changed since snapshot {snapshots[0].snapshot_number}.
          </p>
        )}
        <SnapshotContents items={preview.items} revisions={revisionMap(facts)} gaps={new Map(gaps.map((g) => [g.id, g]))} />
        {canLock && !unchanged && factCount > 0 && <LockForm projectId={id} fingerprint={preview.fingerprint} nextNumber={nextNumber} />}
        {!canLock && <p className="text-sm text-zinc-500">Only reviewers and admins can lock snapshots.</p>}
        {canLock && factCount === 0 && <p className="text-sm text-zinc-500">Approve at least one fact before locking a snapshot.</p>}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Locked snapshots ({snapshots.length})</h2>
        {snapshots.length === 0 && <p className="text-sm text-zinc-500">None yet.</p>}
        <ul className="flex flex-col gap-2" data-testid="snapshot-list">
          {snapshots.map((s) => (
            <li key={s.id} className="text-sm">
              <Link href={`/projects/${id}/snapshots/${s.snapshot_number}`} className="font-medium underline">
                Snapshot {s.snapshot_number}
              </Link>{" "}
              · {s.fact_count} facts · {s.gap_count} open gaps · {s.excluded_count} left out · locked by{" "}
              {memberLabel(members, s.locked_by)} · {formatUtc(s.locked_at)}
            </li>
          ))}
        </ul>
      </section>
    </PageShell>
  );
}
