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
  const [facts, members, versions] = await Promise.all([
    listFacts(m.orgId, id),
    listMembers(m.orgId),
    listCitableVersions(m.orgId, id),
  ]);
  const active = project.status === "active";
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
          approve it (admins can, and are shown as self-approved). Only approved facts can be used for drafting.
        </p>
      </header>

      {canPropose && (
        <section className="rounded border border-zinc-200 p-4">
          <h2 className="mb-3 text-lg font-semibold">Add a fact</h2>
          <FactForm projectId={id} versions={versions} submitLabel="Add candidate fact" />
        </section>
      )}

      {groups.map(([title, list]) => (
        <section key={title} className="flex flex-col gap-3" data-testid={`group-${title}`}>
          <h2 className="text-lg font-semibold">
            {title} ({list.length})
          </h2>
          {list.length === 0 && <p className="text-sm text-zinc-500">None.</p>}
          {list.map((f) => (
            <FactCard key={f.id} fact={f} m={m} members={members} projectId={id} versions={versions} active={active} />
          ))}
        </section>
      ))}
    </PageShell>
  );
}

function Revision({ r, members }: { r: FactRevision; members: Member[] }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`rounded px-2 py-0.5 font-medium ${STATUS_STYLE[r.status]}`} data-testid="fact-status">
          {STATUS_TEXT[r.status]}
        </span>
        <span className="text-zinc-500">revision {r.revision_number}</span>
        {r.self_approved && (
          <span className="rounded bg-amber-50 px-2 py-0.5 text-amber-900" data-testid="self-approved">
            Self-approved by admin
          </span>
        )}
      </div>
      <p className="font-medium" data-testid="fact-statement">
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
}: {
  fact: FactView;
  m: CurrentMembership;
  members: Member[];
  projectId: string;
  versions: CitableVersion[];
  active: boolean;
}) {
  const r = fact.current;
  const isReviewer = hasRole(m, ["admin", "reviewer"]);
  const wroteIt = r.created_by === m.user.id;
  const canReview = active && r.status === "candidate" && isReviewer && (!wroteIt || m.role === "admin");
  const canEdit = active && hasRole(m, ["admin", "author", "reviewer"]);
  const c = r.citations[0];

  return (
    <article className="flex flex-col gap-3 rounded border border-zinc-200 p-4" data-testid="fact-card">
      <Revision r={r} members={members} />
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
              <Revision key={h.id} r={h} members={members} />
            ))}
          </div>
        </details>
      )}
    </article>
  );
}
