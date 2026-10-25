/** Shared SYNTHETIC fixtures for evidence tests (facts, gaps, conflicts). */
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { asOwner, asUser, insertProject, projectInput, seedFirm } from "./helpers";

/** A firm, an active project, and one STORED synthetic source version (inserted directly as owner). */
export async function setup() {
  const f = await seedFirm();
  const p = await asUser(f.users.author, (c) => insertProject(c, projectInput(f.orgId, f.users.author)));
  const versionId = await storedVersion(f.orgId, p.id, f.users.author);
  return { ...f, projectId: p.id as string, versionId };
}

export async function storedVersion(orgId: string, projectId: string, uploader: string, status: "stored" | "blocked" = "stored") {
  const sourceId = randomUUID();
  const versionId = randomUUID();
  await asOwner(async (c) => {
    await c.query("insert into sources (id, org_id, project_id, title, created_by) values ($1,$2,$3,'SYNTHETIC notes.pdf',$4)", [
      sourceId,
      orgId,
      projectId,
      uploader,
    ]);
    await c.query(
      `insert into source_versions (id, org_id, project_id, source_id, version_number, original_filename, byte_size,
         detected_type, sha256, storage_path, status, block_reason, uploaded_by, completed_at)
       values ($1,$2,$3,$4,1,'SYNTHETIC notes.pdf',100,$5,$6,$7,$8,$9,$10, now())`,
      [
        versionId,
        orgId,
        projectId,
        sourceId,
        status === "stored" ? "pdf" : null,
        status === "stored" ? "b".repeat(64) : null,
        status === "stored" ? `${orgId}/${projectId}/${sourceId}/${versionId}` : null,
        status,
        status === "blocked" ? "unsupported_type" : null,
        uploader,
      ],
    );
  });
  return versionId;
}

export const cite = (versionId: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify([{ source_version_id: versionId, page: 3, excerpt: "SYNTHETIC excerpt: span 24 m", ...extra }]);

export async function createFact(c: PoolClient, projectId: string, citations: string, statement = "SYNTHETIC: Span is 24 m.") {
  const { rows } = await c.query("select * from create_fact($1, $2, $3::jsonb)", [projectId, statement, citations]);
  return rows[0] as { fact_id: string; revision_id: string };
}

export async function review(c: PoolClient, revisionId: string, decision: "approve" | "reject", note: string | null = null) {
  const { rows } = await c.query("select review_fact_revision($1, $2, $3) as r", [revisionId, decision, note]);
  return rows[0].r as string;
}

export async function revise(c: PoolClient, factId: string, basedOn: string, citations: string, statement = "SYNTHETIC: Span is 24.5 m.") {
  const { rows } = await c.query("select * from revise_fact($1, $2, $3, $4::jsonb)", [factId, basedOn, statement, citations]);
  return rows[0] as { revision_id: string; revision_number: number };
}

export const revisionRow = (id: string) =>
  asOwner(async (c) => (await c.query("select * from fact_revisions where id = $1", [id])).rows[0]);

