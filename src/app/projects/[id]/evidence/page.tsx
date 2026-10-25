import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { hasRole, requireMembership, type CurrentMembership } from "@/lib/auth";
import { getProject, listMembers, memberLabel, type Member } from "@/lib/projects";
import { listCitableVersions, listFacts, type CitableVersion, type FactRevision, type FactView } from "@/lib/facts";
import { formatUtc } from "@/lib/format";
import { PageShell } from "@/app/page-shell";
import { FactForm } from "./fact-form";
import { ReviewControls } from "./review-controls";
import { conflictFlags, listConflicts, listGaps, type Conflict, type Gap } from "@/lib/gaps-conflicts";
import { CloseGapForm, RaiseConflictForm, RaiseGapForm, ResolveConflictForm } from "./gap-conflict-forms";

type Props = { params: Promise<{ id: string }> };

export default function EvidencePage({ params }: Props) {
  return (
    <Suspense fallback={<PageShell>Loading…</PageShell>}>
      <Evidence params={params} />
    </Suspense>
  );
}

const STATUS_STYLE: Record<FactRevision["status"], string> = {
  candidate: "bg-amber-100 text-amber-900",
  approved: "bg-emerald-100 text-emerald-900",
  rejected: "bg-red-100 text-red-900",
  superseded: "bg-zinc-100 text-zinc-700",
};
const STATUS_TEXT: Record<FactRevision["status"], string> = {
  candidate: "Needs review",
  approved: "Approved",
  rejected: "Rejected",
  superseded: "Superseded",
};

async function Evidence({ params }: Props) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const m = await requireMembership();
  const project = await getProject(m.orgId, id);
  if (!project) notFound();
  const [facts, members, versions, gaps, conflicts] = await Promise.all([
    listFacts(m.orgId, id),
    listMembers(m.orgId),
    listCitableVersions(m.orgId, id),
    listGaps(m.orgId, id),
    listConflicts(m.orgId, id),
  ]);
  const active = project.status === "active";
  const flags = conflictFlags(conflicts);
  const canClose = active && hasRole(m, ["admin", "reviewer"]);
  const statementOf = new Map(facts.map((f) => [f.id, f.current.statement]));
  const approvedFacts = facts
    .filter((f) => f.current.status === "approved")
    .map((f) => ({ revisionId: f.current.id, statement: f.current.statement }));
  const allFacts = facts.map((f) => ({ factId: f.id, statement: f.current.statement }));
  const canPropose = active && hasRole(m, ["admin", "author", "reviewer"]);

  const groups: [string, FactView[]][] = [
    ["Needs review", facts.filter((f) => f.current.status === "candidate")],
    ["Approved", facts.filter((f) => f.current.status === "approved")],
    ["Rejected", facts.filter((f) => f.current.status === "rejected")],
  ];

  return (
    <PageShell back={{ href: `/projects/${id}`, label: project.name }}>
      <header>
        <h1 className="text-2xl font-semibold">Evidence review</h1>
        <p className="text-sm text-zinc-600">
          Candidate facts are not evidence until a reviewer approves them. The person who wrote a fact cannot
          approve it (admins can, and are shown as self-approved). Only approved facts can be used for drafting,
          once a reviewer locks them into a{" "}
          <Link className="underline" href={`/projects/${id}/snapshots`}>
            snapshot
          </Link>
          .
        </p>
      </header>

      {canPropose && (
        <section className="rounded border border-zinc-200 p-4">
          <h2 className="mb-3 text-lg font-semibold">Add a fact</h2>
          <FactForm projectId={id} versions={versions} submitLabel="Add candidate fact" />
        </section>
      )}

      <GapsSection
        gaps={gaps}
        members={members}
        m={m}
        projectId={id}
        canRaise={canPropose}
        canClose={canClose}
        approvedFacts={approvedFacts}
        statementOfRevision={new Map(facts.flatMap((f) => [f.current, ...f.history]).map((r) => [r.id, r.statement]))}
      />
      <ConflictsSection
        conflicts={conflicts}
        members={members}
        m={m}
        projectId={id}
        canRaise={canPropose}
        canClose={canClose}
        allFacts={allFacts}
        statementOf={statementOf}
      />

      {groups.map(([title, list]) => (
        <section key={title} className="flex flex-col gap-3" data-testid={`group-${title}`}>
          <h2 className="text-lg font-semibold">
            {title} ({list.length})
          </h2>
          {list.length === 0 && <p className="text-sm text-zinc-500">None.</p>}
          {list.map((f) => (
            <FactCard
              key={f.id}
              fact={f}
              m={m}
              members={members}
              projectId={id}
              versions={versions}
              active={active}
              inOpenConflict={flags.inOpen.has(f.id)}
              lostConflict={flags.lost.has(f.id)}
            />
          ))}
        </section>
      ))}
    </PageShell>
  );
}

function Revision({ r, members, isCurrent }: { r: FactRevision; members: Member[]; isCurrent: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`rounded px-2 py-0.5 font-medium ${STATUS_STYLE[r.status]}`} data-testid={isCurrent ? "fact-status" : "earlier-status"}>
          {STATUS_TEXT[r.status]}
        </span>
        <span className="text-zinc-500">revision {r.revision_number}</span>
        {r.self_approved && (
          <span className="rounded bg-amber-50 px-2 py-0.5 text-amber-900" data-testid="self-approved">
            Self-approved by admin
          </span>
        )}
      </div>
      <p className="font-medium" data-testid={isCurrent ? "fact-statement" : "earlier-statement"}>
        {r.statement}
      </p>
      {r.citations.map((c) => (
        <div key={c.id} className="border-l-2 border-zinc-300 pl-3 text-sm">
          <p className="text-zinc-600" data-testid="fact-citation">
            {c.filename} · v{c.version_number}
            {c.page ? ` · p. ${c.page}` : ""}
            {c.section ? ` · ${c.section}` : ""}
          </p>
          <blockquote className="whitespace-pre-wrap text-zinc-800">“{c.excerpt}”</blockquote>
        </div>
      ))}
      {r.citations.length === 0 && <p className="text-sm text-red-700">No cited source — cannot be approved.</p>}
      <p className="text-xs text-zinc-500">
        Proposed by {memberLabel(members, r.created_by)} · {formatUtc(r.created_at)}
        {r.reviewed_by && (
          <>
            {" "}
            · {r.status === "rejected" ? "Rejected" : "Approved"} by {memberLabel(members, r.reviewed_by)} ·{" "}
            {formatUtc(r.reviewed_at!)}
          </>
        )}
      </p>
      {r.review_note && <p className="text-sm text-zinc-700">Review note: {r.review_note}</p>}
    </div>
  );
}

function FactCard({
  fact,
  m,
  members,
  projectId,
  versions,
  active,
  inOpenConflict,
  lostConflict,
}: {
  fact: FactView;
  m: CurrentMembership;
  members: Member[];
  projectId: string;
  versions: CitableVersion[];
  active: boolean;
  inOpenConflict: boolean;
  lostConflict: boolean;
}) {
  const r = fact.current;
  const isReviewer = hasRole(m, ["admin", "reviewer"]);
  const wroteIt = r.created_by === m.user.id;
  const canReview = active && r.status === "candidate" && isReviewer && (!wroteIt || m.role === "admin");
  const canEdit = active && hasRole(m, ["admin", "author", "reviewer"]);
  const c = r.citations[0];

  return (
    <article className="flex flex-col gap-3 rounded border border-zinc-200 p-4" data-testid="fact-card">
      {(inOpenConflict || lostConflict) && (
        <p className="w-fit rounded bg-red-50 px-2 py-0.5 text-xs font-medium text-red-900" data-testid="conflict-flag">
          {inOpenConflict ? "In an open conflict — excluded from snapshots until resolved" : "Did not prevail in a conflict — excluded from snapshots"}
        </p>
      )}
      <Revision r={r} members={members} isCurrent />
      {r.status === "candidate" && isReviewer && wroteIt && m.role !== "admin" && (
        <p className="text-sm text-amber-900" data-testid="own-fact-note">
          You wrote this revision, so another reviewer must review it.
        </p>
      )}
      {canReview && <ReviewControls projectId={projectId} revisionId={r.id} />}
      {canEdit && (
        <details>
          <summary className="cursor-pointer text-sm underline">Edit (creates a new revision that needs review)</summary>
          <div className="mt-3">
            <FactForm
              projectId={projectId}
              versions={versions}
              submitLabel="Save as new revision"
              edit={{
                factId: fact.id,
                basedOn: r.id,
                initial: {
                  statement: r.statement,
                  source_version_id: c?.source_version_id ?? "",
                  page: c?.page ? String(c.page) : "",
                  section: c?.section ?? "",
                  excerpt: c?.excerpt ?? "",
                },
              }}
            />
          </div>
        </details>
      )}
      {fact.history.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm text-zinc-600 underline">Earlier revisions ({fact.history.length})</summary>
          <div className="mt-3 flex flex-col gap-4 border-l border-zinc-200 pl-3">
            {fact.history.map((h) => (
              <Revision key={h.id} r={h} members={members} isCurrent={false} />
            ))}
          </div>
        </details>
      )}
    </article>
  );
}

function closedLine(by: string | null, at: string | null, members: Member[], verb: string, self: boolean) {
  if (!by || !at) return null;
  return (
    <p className="text-xs text-zinc-500">
      {verb} by {memberLabel(members, by)} · {formatUtc(at)}
      {self && (
        <span className="ml-2 rounded bg-amber-50 px-2 py-0.5 text-amber-900" data-testid="self-closed">
          Closed by the admin who raised it
        </span>
      )}
    </p>
  );
}

function GapsSection({
  gaps,
  members,
  m,
  projectId,
  canRaise,
  canClose,
  approvedFacts,
  statementOfRevision,
}: {
  gaps: Gap[];
  members: Member[];
  m: CurrentMembership;
  projectId: string;
  canRaise: boolean;
  canClose: boolean;
  approvedFacts: { revisionId: string; statement: string }[];
  statementOfRevision: Map<string, string>;
}) {
  const open = gaps.filter((g) => g.status === "open");
  const closed = gaps.filter((g) => g.status !== "open");
  return (
    <section className="flex flex-col gap-3 rounded border border-zinc-200 p-4" data-testid="gaps-section">
      <h2 className="text-lg font-semibold">Missing information ({open.length} open)</h2>
      <p className="text-sm text-zinc-600">
        Open gaps will appear in drafts as &ldquo;information needed&rdquo; markers. They are never filled in automatically.
      </p>
      {canRaise && <RaiseGapForm projectId={projectId} />}
      {[...open, ...closed].map((g) => (
        <article key={g.id} className="flex flex-col gap-2 border-t border-zinc-100 pt-3" data-testid="gap-card">
          <div className="flex items-center gap-2 text-xs">
            <span
              data-testid="gap-status"
              className={`rounded px-2 py-0.5 font-medium ${g.status === "open" ? "bg-amber-100 text-amber-900" : "bg-zinc-100 text-zinc-700"}`}
            >
              {g.status === "open" ? "Open" : g.status === "resolved" ? "Resolved" : "Dismissed"}
            </span>
            <span className="text-zinc-500">
              Raised by {memberLabel(members, g.created_by)} · {formatUtc(g.created_at)}
            </span>
          </div>
          <p className="text-sm font-medium">{g.description}</p>
          {g.status === "resolved" && g.resolving_fact_revision_id && (
            <p className="text-sm text-zinc-700" data-testid="gap-resolution">
              Filled by: {statementOfRevision.get(g.resolving_fact_revision_id) ?? "an approved fact"}
            </p>
          )}
          {g.closing_note && <p className="text-sm text-zinc-700">Note: {g.closing_note}</p>}
          {closedLine(g.closed_by, g.closed_at, members, g.status === "resolved" ? "Resolved" : "Dismissed", g.self_closed)}
          {g.status === "open" && canClose && g.created_by === m.user.id && m.role !== "admin" && (
            <p className="text-sm text-amber-900">You raised this gap, so another reviewer must close it.</p>
          )}
          {g.status === "open" && canClose && (g.created_by !== m.user.id || m.role === "admin") && (
            <CloseGapForm projectId={projectId} gapId={g.id} approvedFacts={approvedFacts} />
          )}
        </article>
      ))}
    </section>
  );
}

function ConflictsSection({
  conflicts,
  members,
  m,
  projectId,
  canRaise,
  canClose,
  allFacts,
  statementOf,
}: {
  conflicts: Conflict[];
  members: Member[];
  m: CurrentMembership;
  projectId: string;
  canRaise: boolean;
  canClose: boolean;
  allFacts: { factId: string; statement: string }[];
  statementOf: Map<string, string>;
}) {
  const open = conflicts.filter((c) => c.status === "open");
  const closed = conflicts.filter((c) => c.status !== "open");
  return (
    <section className="flex flex-col gap-3 rounded border border-zinc-200 p-4" data-testid="conflicts-section">
      <h2 className="text-lg font-semibold">Conflicts ({open.length} open)</h2>
      {canRaise && <RaiseConflictForm projectId={projectId} facts={allFacts} />}
      {[...open, ...closed].map((c) => {
        const members_ = c.fact_ids.map((fid) => ({ factId: fid, statement: statementOf.get(fid) ?? "Unknown fact" }));
        return (
          <article key={c.id} className="flex flex-col gap-2 border-t border-zinc-100 pt-3" data-testid="conflict-card">
            <div className="flex items-center gap-2 text-xs">
              <span
                data-testid="conflict-status"
                className={`rounded px-2 py-0.5 font-medium ${c.status === "open" ? "bg-red-100 text-red-900" : "bg-zinc-100 text-zinc-700"}`}
              >
                {c.status === "open" ? "Open" : "Resolved"}
              </span>
              <span className="text-zinc-500">
                Raised by {memberLabel(members, c.created_by)} · {formatUtc(c.created_at)}
              </span>
            </div>
            <p className="text-sm font-medium">{c.description}</p>
            <ul className="list-disc pl-5 text-sm">
              {members_.map((f) => (
                <li key={f.factId} data-testid={c.prevailing_fact_id === f.factId ? "prevailing-fact" : "conflict-fact"}>
                  {f.statement}
                  {c.prevailing_fact_id === f.factId && <span className="ml-2 text-emerald-800">— stands</span>}
                </li>
              ))}
            </ul>
            {c.resolution_note && <p className="text-sm text-zinc-700">Note: {c.resolution_note}</p>}
            {closedLine(c.resolved_by, c.resolved_at, members, "Resolved", c.self_closed)}
            {c.status === "open" && canClose && c.created_by === m.user.id && m.role !== "admin" && (
              <p className="text-sm text-amber-900">You raised this conflict, so another reviewer must resolve it.</p>
            )}
            {c.status === "open" && canClose && (c.created_by !== m.user.id || m.role === "admin") && (
              <ResolveConflictForm projectId={projectId} conflictId={c.id} facts={members_} />
            )}
          </article>
        );
      })}
    </section>
  );
}
