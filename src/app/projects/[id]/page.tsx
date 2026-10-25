import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { hasRole, requireMembership } from "@/lib/auth";
import { getProject, listMembers, listProjectAudit, memberLabel } from "@/lib/projects";
import { documentTypeLabel } from "@/config/document-types";
import { describeAudit, formatUtc } from "@/lib/format";
import { PageShell } from "@/app/page-shell";
import { StatusButton } from "./status-button";
import { FilesSection } from "./files/files-section";
import { listSources } from "@/lib/sources";

type Props = { params: Promise<{ id: string }> };

export default function ProjectPage({ params }: Props) {
  return (
    <PageShell back={{ href: "/dashboard", label: "Projects" }}>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <ProjectDetail params={params} />
      </Suspense>
    </PageShell>
  );
}

async function ProjectDetail({ params }: Props) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const m = await requireMembership();
  const project = await getProject(m.orgId, id);
  if (!project) notFound(); // Also what users from other firms get (RLS hides the row).
  const [members, audit, sources] = await Promise.all([
    listMembers(m.orgId),
    listProjectAudit(m.orgId, id),
    listSources(m.orgId, id),
  ]);
  const canEdit = hasRole(m, ["admin", "author"]);
  const archived = project.status === "archived";

  return (
    <>
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{project.name}</h1>
          <p className="text-sm text-zinc-600">
            <span data-testid="project-status">{archived ? "Archived" : "Active"}</span> · version{" "}
            {project.row_version} · updated {formatUtc(project.updated_at)}
          </p>
        </div>
        <div className="flex items-start gap-2">
          <Link href={`/projects/${project.id}/evidence`} className="rounded border border-zinc-300 px-3 py-1.5 text-sm">
            Evidence review
          </Link>
        </div>
        {canEdit && (
          <div className="flex items-start gap-2">
            {!archived && (
              <Link href={`/projects/${project.id}/edit`} className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white">
                Edit
              </Link>
            )}
            <StatusButton id={project.id} rowVersion={project.row_version} archived={archived} />
          </div>
        )}
      </header>

      <dl className="grid grid-cols-[12rem_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-zinc-500">Client</dt>
        <dd data-testid="project-client">{project.client_name}</dd>
        <dt className="text-zinc-500">Location</dt>
        <dd>{project.location}</dd>
        <dt className="text-zinc-500">Document type</dt>
        <dd>{documentTypeLabel(project.document_type)}</dd>
        <dt className="text-zinc-500">Assigned reviewer</dt>
        <dd data-testid="project-reviewer">{memberLabel(members, project.assigned_reviewer_id)}</dd>
        <dt className="text-zinc-500">Created by</dt>
        <dd>
          {memberLabel(members, project.created_by)} · {formatUtc(project.created_at)}
        </dd>
        <dt className="text-zinc-500">Scope and instructions</dt>
        <dd className="whitespace-pre-wrap">{project.scope_instructions || "—"}</dd>
      </dl>

      <FilesSection
        projectId={project.id}
        sources={sources}
        members={members}
        canUpload={canEdit}
        archived={archived}
      />

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">History</h2>
        <ol className="flex flex-col gap-1 text-sm" data-testid="project-history">
          {audit.map((a) => (
            <li key={a.id} className="text-zinc-700">
              <span className="text-zinc-500">{formatUtc(a.occurred_at)}</span> ·{" "}
              {a.actor_type === "system" ? "System" : memberLabel(members, a.actor_id)} ·{" "}
              {describeAudit(a.action, a.details.changed_fields)}
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
