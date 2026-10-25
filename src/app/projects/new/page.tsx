import { Suspense } from "react";
import { hasRole, requireMembership } from "@/lib/auth";
import { listMembers } from "@/lib/projects";
import { NotAllowed, PageShell } from "@/app/page-shell";
import { ProjectForm } from "../project-form";
import { createProject } from "../actions";
import { documentTypeOptions, reviewerOptions } from "../options";

export default function NewProjectPage() {
  return (
    <PageShell back={{ href: "/dashboard", label: "Projects" }}>
      <h1 className="text-2xl font-semibold">New project</h1>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <NewProject />
      </Suspense>
    </PageShell>
  );
}

async function NewProject() {
  const m = await requireMembership();
  if (!hasRole(m, ["admin", "author"])) return <NotAllowed />;
  const members = await listMembers(m.orgId);
  return (
    <ProjectForm
      action={createProject}
      submitLabel="Create project"
      documentTypes={documentTypeOptions()}
      reviewers={reviewerOptions(members)}
      initial={{ name: "", client_name: "", location: "", document_type: "", scope_instructions: "", assigned_reviewer_id: "" }}
    />
  );
}
