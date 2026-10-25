import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { hasRole, requireMembership } from "@/lib/auth";
import { getProject, listMembers } from "@/lib/projects";
import { NotAllowed, PageShell } from "@/app/page-shell";
import { ProjectForm } from "../../project-form";
import { updateProject } from "../../actions";
import { documentTypeOptions, reviewerOptions } from "../../options";

type Props = { params: Promise<{ id: string }> };

export default function EditProjectPage({ params }: Props) {
  return (
    <Suspense fallback={<PageShell>Loading…</PageShell>}>
      <EditProject params={params} />
    </Suspense>
  );
}

async function EditProject({ params }: Props) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const m = await requireMembership();
  const project = await getProject(m.orgId, id);
  if (!project) notFound();

  return (
    <PageShell back={{ href: `/projects/${id}`, label: project.name }}>
      <h1 className="text-2xl font-semibold">Edit project</h1>
      {!hasRole(m, ["admin", "author"]) ? (
        <NotAllowed />
      ) : project.status === "archived" ? (
        <p role="alert" className="text-sm text-amber-900">Restore this project before editing it.</p>
      ) : (
        <ProjectForm
          action={updateProject}
          submitLabel="Save changes"
          documentTypes={documentTypeOptions()}
          reviewers={reviewerOptions(await listMembers(m.orgId))}
          versionRef={{ id: project.id, row_version: project.row_version }}
          initial={{
            name: project.name,
            client_name: project.client_name,
            location: project.location,
            document_type: project.document_type,
            scope_instructions: project.scope_instructions,
            assigned_reviewer_id: project.assigned_reviewer_id ?? "",
          }}
        />
      )}
    </PageShell>
  );
}
