import Link from "next/link";
import { Suspense } from "react";
import { hasRole, requireMembership } from "@/lib/auth";
import { listProjects } from "@/lib/projects";
import { documentTypeLabel } from "@/config/document-types";
import { formatUtc } from "@/lib/format";
import { SignOutButton } from "@/app/sign-out-button";
import { PageShell } from "@/app/page-shell";

export default function DashboardPage() {
  return (
    <PageShell>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <Dashboard />
      </Suspense>
    </PageShell>
  );
}

async function Dashboard() {
  const m = await requireMembership();
  const projects = await listProjects(m.orgId);
  const canEdit = hasRole(m, ["admin", "author"]);

  return (
    <>
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{m.orgName}</h1>
          <p className="text-sm text-zinc-600">
            Signed in as <span data-testid="user-email">{m.user.email}</span> ·{" "}
            <span data-testid="user-role">{m.role}</span>
          </p>
        </div>
        <SignOutButton />
      </header>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Projects</h2>
          {canEdit && (
            <Link href="/projects/new" className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white">
              New project
            </Link>
          )}
        </div>
        {projects.length === 0 ? (
          <p className="rounded border border-dashed border-zinc-300 p-6 text-sm text-zinc-600">
            No projects yet.{canEdit ? " Create the first one." : ""}
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 text-zinc-500">
              <tr>
                <th className="py-2 pr-4 font-medium">Project</th>
                <th className="py-2 pr-4 font-medium">Client</th>
                <th className="py-2 pr-4 font-medium">Document type</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 font-medium">Last updated</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} className="border-b border-zinc-100">
                  <td className="py-2 pr-4">
                    <Link href={`/projects/${p.id}`} className="font-medium underline">
                      {p.name}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{p.client_name}</td>
                  <td className="py-2 pr-4">{documentTypeLabel(p.document_type)}</td>
                  <td className="py-2 pr-4">{p.status}</td>
                  <td className="py-2">{formatUtc(p.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
