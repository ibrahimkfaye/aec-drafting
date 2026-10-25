import Link from "next/link";
import { Suspense } from "react";
import { z } from "zod";
import { requireMembership } from "@/lib/auth";
import { listMembers, listProjects, memberLabel } from "@/lib/projects";
import { listFirmAudit } from "@/lib/audit";
import { AUDIT_GROUPS, auditExtra, describeAudit, formatUtc, type AuditGroup } from "@/lib/format";
import { PageShell } from "@/app/page-shell";

type Search = { project?: string; person?: string; type?: string; before?: string };
type Props = { searchParams: Promise<Search> };

const filterSchema = z.object({
  project: z.uuid().optional().catch(undefined),
  person: z.uuid().optional().catch(undefined),
  type: z.enum(Object.keys(AUDIT_GROUPS) as [AuditGroup, ...AuditGroup[]]).optional().catch(undefined),
  before: z.coerce.number().int().positive().optional().catch(undefined),
});

export default function HistoryPage({ searchParams }: Props) {
  return (
    <PageShell back={{ href: "/dashboard", label: "Projects" }}>
      <h1 className="text-2xl font-semibold">Firm history</h1>
      <p className="text-sm text-zinc-600">
        Every recorded action across your firm&rsquo;s projects. This log cannot be edited or deleted. It records what
        happened, not the content of documents or facts.
      </p>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <History searchParams={searchParams} />
      </Suspense>
    </PageShell>
  );
}

async function History({ searchParams }: Props) {
  const m = await requireMembership();
  const f = filterSchema.parse(await searchParams);
  const [members, projects, { events, hasMore }] = await Promise.all([
    listMembers(m.orgId),
    listProjects(m.orgId),
    listFirmAudit(m.orgId, { projectId: f.project, actorId: f.person, group: f.type, before: f.before }),
  ]);
  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  const select = "rounded border border-zinc-300 px-2 py-1.5 text-sm";

  const olderHref = () => {
    const q = new URLSearchParams();
    if (f.project) q.set("project", f.project);
    if (f.person) q.set("person", f.person);
    if (f.type) q.set("type", f.type);
    q.set("before", String(events[events.length - 1].id));
    return `/history?${q}`;
  };

  return (
    <>
      <form method="get" className="flex flex-wrap items-end gap-3" data-testid="history-filters">
        <label className="flex flex-col gap-1 text-sm">
          Project
          <select name="project" defaultValue={f.project ?? ""} className={select}>
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Person
          <select name="person" defaultValue={f.person ?? ""} className={select}>
            <option value="">Everyone</option>
            {members.map((u) => (
              <option key={u.user_id} value={u.user_id}>
                {u.display_name || u.email}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Type
          <select name="type" defaultValue={f.type ?? ""} className={select}>
            <option value="">All actions</option>
            {Object.entries(AUDIT_GROUPS).map(([key, g]) => (
              <option key={key} value={key}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white">
          Apply
        </button>
        {(f.project || f.person || f.type) && (
          <Link href="/history" className="text-sm underline">
            Clear filters
          </Link>
        )}
      </form>

      {events.length === 0 ? (
        <p className="text-sm text-zinc-500">No matching events.</p>
      ) : (
        <table className="w-full text-left text-sm" data-testid="history-table">
          <thead className="border-b border-zinc-200 text-zinc-500">
            <tr>
              <th className="py-2 pr-4 font-medium">When</th>
              <th className="py-2 pr-4 font-medium">Who</th>
              <th className="py-2 pr-4 font-medium">What</th>
              <th className="py-2 font-medium">Project</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => {
              const extra = auditExtra(e.action, e.details);
              return (
                <tr key={e.id} className="border-b border-zinc-100 align-top" data-testid="history-row">
                  <td className="py-2 pr-4 whitespace-nowrap text-zinc-500">{formatUtc(e.occurred_at)}</td>
                  <td className="py-2 pr-4">{e.actor_type === "system" ? "System" : memberLabel(members, e.actor_id)}</td>
                  <td className="py-2 pr-4" data-testid="history-what">
                    {describeAudit(e.action, e.details.changed_fields)}
                    {extra.length > 0 && <span className="text-zinc-500"> · {extra.join(" · ")}</span>}
                  </td>
                  <td className="py-2">
                    {e.project_id ? (
                      <Link href={`/projects/${e.project_id}`} className="underline">
                        {projectName.get(e.project_id) ?? "Project"}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {hasMore && (
        <Link href={olderHref()} className="w-fit text-sm underline" data-testid="history-older">
          Older events →
        </Link>
      )}
    </>
  );
}
