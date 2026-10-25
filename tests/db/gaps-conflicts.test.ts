/**
 * Gaps and conflicts (migration 0005). All data is SYNTHETIC.
 */
import { afterAll, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { asOwner, asUser, pool, seedFirm } from "./helpers";
import { cite, createFact, review, revise, setup } from "./fixtures";

afterAll(async () => {
  await pool.end();
});

const createGap = async (c: PoolClient, projectId: string, d = "SYNTHETIC: No bearing capacity for Pier 3") =>
  (await c.query("select create_gap($1, $2) as id", [projectId, d])).rows[0].id as string;

const closeGap = async (c: PoolClient, gapId: string, decision: string, revisionId: string | null, note: string | null) =>
  (await c.query("select close_gap($1, $2, $3, $4) as r", [gapId, decision, revisionId, note])).rows[0].r as string;

const createConflict = async (c: PoolClient, projectId: string, factIds: string[], d = "SYNTHETIC: span values disagree") =>
  (await c.query("select create_conflict($1, $2, $3::uuid[]) as id", [projectId, d, factIds])).rows[0].id as string;

const resolveConflict = async (c: PoolClient, id: string, prevailing: string, note: string | null) =>
  (await c.query("select resolve_conflict($1, $2, $3) as r", [id, prevailing, note])).rows[0].r as string;

const row = (table: string, id: string) =>
  asOwner(async (c) => (await c.query(`select * from ${table} where id = $1`, [id])).rows[0]);

/** An approved fact written by the author and approved by the reviewer. */
async function approvedFact(f: Awaited<ReturnType<typeof setup>>, statement?: string) {
  const fact = await asUser(f.users.author, (c) => createFact(c, f.projectId, cite(f.versionId), statement));
  await asUser(f.users.reviewer, (c) => review(c, fact.revision_id, "approve"));
  return fact;
}

describe("gaps", () => {
  it("author raises a gap; a reviewer resolves it with a current approved fact", async () => {
    const f = await setup();
    const gapId = await asUser(f.users.author, (c) => createGap(c, f.projectId));
    const fact = await approvedFact(f);
    expect(await asUser(f.users.reviewer, (c) => closeGap(c, gapId, "resolve", fact.revision_id, null))).toBe("resolved");
    expect(await row("gaps", gapId)).toMatchObject({
      status: "resolved",
      closed_by: f.users.reviewer,
      resolving_fact_revision_id: fact.revision_id,
      self_closed: false,
    });
  });

  it("a candidate, rejected or outdated fact cannot resolve a gap", async () => {
    const f = await setup();
    const gapId = await asUser(f.users.author, (c) => createGap(c, f.projectId));
    const candidate = await asUser(f.users.author, (c) => createFact(c, f.projectId, cite(f.versionId)));
    await expect(asUser(f.users.reviewer, (c) => closeGap(c, gapId, "resolve", candidate.revision_id, null))).rejects.toThrow(
      /current, approved fact/,
    );
    const approved = await approvedFact(f);
    await asUser(f.users.author, (c) => revise(c, approved.fact_id, approved.revision_id, cite(f.versionId)));
    await expect(asUser(f.users.reviewer, (c) => closeGap(c, gapId, "resolve", approved.revision_id, null))).rejects.toThrow(
      /current, approved fact/,
    );
  });

  it("a fact from another project cannot resolve a gap", async () => {
    const f = await setup();
    const g = await setup();
    const gapId = await asUser(f.users.author, (c) => createGap(c, f.projectId));
    const elsewhere = await approvedFact(g);
    await expect(asUser(f.users.reviewer, (c) => closeGap(c, gapId, "resolve", elsewhere.revision_id, null))).rejects.toThrow(
      /not found in this project/,
    );
  });

  it("dismissing needs a reason; closed gaps are final", async () => {
    const f = await setup();
    const gapId = await asUser(f.users.author, (c) => createGap(c, f.projectId));
    await expect(asUser(f.users.reviewer, (c) => closeGap(c, gapId, "dismiss", null, " "))).rejects.toThrow(/needs a note/);
    expect(await asUser(f.users.reviewer, (c) => closeGap(c, gapId, "dismiss", null, "SYNTHETIC: not needed for this memo"))).toBe(
      "dismissed",
    );
    await expect(asUser(f.users.admin, (c) => closeGap(c, gapId, "dismiss", null, "again"))).rejects.toThrow(/already closed/);
  });

  it("separation of duties: a reviewer cannot close a gap they raised; an admin can and is flagged", async () => {
    const f = await setup();
    const own = await asUser(f.users.reviewer, (c) => createGap(c, f.projectId));
    await expect(asUser(f.users.reviewer, (c) => closeGap(c, own, "dismiss", null, "x"))).rejects.toThrow(/separation of duties/);
    const adminGap = await asUser(f.users.admin, (c) => createGap(c, f.projectId));
    await asUser(f.users.admin, (c) => closeGap(c, adminGap, "dismiss", null, "SYNTHETIC reason"));
    expect(await row("gaps", adminGap)).toMatchObject({ self_closed: true });
  });

  it("authors and viewers cannot close gaps; viewers and other firms cannot raise them", async () => {
    const f = await setup();
    const other = await seedFirm(["admin"]);
    const gapId = await asUser(f.users.reviewer, (c) => createGap(c, f.projectId));
    await expect(asUser(f.users.author, (c) => closeGap(c, gapId, "dismiss", null, "x"))).rejects.toThrow(/not allowed/);
    await expect(asUser(f.users.viewer, (c) => createGap(c, f.projectId))).rejects.toThrow(/not allowed/);
    await expect(asUser(other.users.admin, (c) => createGap(c, f.projectId))).rejects.toThrow(/not allowed/);
    await expect(asUser(other.users.admin, (c) => closeGap(c, gapId, "dismiss", null, "x"))).rejects.toThrow(/not allowed/);
  });
});

describe("conflicts", () => {
  it("raises a conflict between two facts and resolves it with a prevailing fact and note", async () => {
    const f = await setup();
    const a = await approvedFact(f, "SYNTHETIC: Span is 24 m.");
    const b = await approvedFact(f, "SYNTHETIC: Span is 42 m.");
    const id = await asUser(f.users.author, (c) => createConflict(c, f.projectId, [a.fact_id, b.fact_id]));
    await expect(asUser(f.users.reviewer, (c) => resolveConflict(c, id, a.fact_id, ""))).rejects.toThrow(/needs a note/);
    expect(await asUser(f.users.reviewer, (c) => resolveConflict(c, id, a.fact_id, "SYNTHETIC: drawing S-101 governs"))).toBe(
      "resolved",
    );
    expect(await row("conflicts", id)).toMatchObject({ status: "resolved", prevailing_fact_id: a.fact_id, self_closed: false });
    await expect(asUser(f.users.admin, (c) => resolveConflict(c, id, b.fact_id, "late"))).rejects.toThrow(/already resolved/);
  });

  it("needs at least two different facts, all from this project", async () => {
    const f = await setup();
    const g = await setup();
    const a = await approvedFact(f);
    const elsewhere = await approvedFact(g);
    await expect(asUser(f.users.author, (c) => createConflict(c, f.projectId, [a.fact_id]))).rejects.toThrow(/at least two/);
    await expect(asUser(f.users.author, (c) => createConflict(c, f.projectId, [a.fact_id, a.fact_id]))).rejects.toThrow(/at least two/);
    await expect(
      asUser(f.users.author, (c) => createConflict(c, f.projectId, [a.fact_id, elsewhere.fact_id])),
    ).rejects.toThrow(/not found in this project/);
  });

  it("the prevailing fact must be one of the conflicting facts", async () => {
    const f = await setup();
    const a = await approvedFact(f);
    const b = await approvedFact(f);
    const outsider = await approvedFact(f);
    const id = await asUser(f.users.author, (c) => createConflict(c, f.projectId, [a.fact_id, b.fact_id]));
    await expect(asUser(f.users.reviewer, (c) => resolveConflict(c, id, outsider.fact_id, "x"))).rejects.toThrow(/one of the conflicting/);
  });

  it("separation of duties applies to conflicts too", async () => {
    const f = await setup();
    const a = await approvedFact(f);
    const b = await approvedFact(f);
    const id = await asUser(f.users.reviewer, (c) => createConflict(c, f.projectId, [a.fact_id, b.fact_id]));
    await expect(asUser(f.users.reviewer, (c) => resolveConflict(c, id, a.fact_id, "x"))).rejects.toThrow(/separation of duties/);
    await expect(asUser(f.users.author, (c) => resolveConflict(c, id, a.fact_id, "x"))).rejects.toThrow(/not allowed/);
    expect(await asUser(f.users.admin, (c) => resolveConflict(c, id, a.fact_id, "SYNTHETIC note"))).toBe("resolved");
  });
});

describe("integrity", () => {
  it("closed items cannot be reopened or edited, nothing can be deleted — even by the owner", async () => {
    const f = await setup();
    const gapId = await asUser(f.users.author, (c) => createGap(c, f.projectId));
    await asUser(f.users.reviewer, (c) => closeGap(c, gapId, "dismiss", null, "SYNTHETIC"));
    await expect(asOwner((c) => c.query("update gaps set status = 'open', closed_by = null, closed_at = null where id = $1", [gapId]))).rejects.toThrow(
      /closed gaps cannot be changed/,
    );
    await expect(asOwner((c) => c.query("delete from gaps where id = $1", [gapId]))).rejects.toThrow(/cannot be deleted/);

    const a = await approvedFact(f);
    const b = await approvedFact(f);
    const cid = await asUser(f.users.author, (c) => createConflict(c, f.projectId, [a.fact_id, b.fact_id]));
    await expect(asOwner((c) => c.query("update conflicts set description = 'x' where id = $1", [cid]))).rejects.toThrow(/immutable/);
    await expect(asOwner((c) => c.query("delete from conflict_facts where conflict_id = $1", [cid]))).rejects.toThrow(/append-only/);
  });

  it("signed-in users have no direct write access", async () => {
    const f = await setup();
    const gapId = await asUser(f.users.author, (c) => createGap(c, f.projectId));
    await expect(asUser(f.users.admin, (c) => c.query("update gaps set status = 'dismissed' where id = $1", [gapId]))).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      asUser(f.users.admin, (c) =>
        c.query("insert into gaps (org_id, project_id, description, created_by) values ($1, $2, 'x', $3)", [
          f.orgId,
          f.projectId,
          f.users.admin,
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("other firms cannot see gaps or conflicts; audit has no description text", async () => {
    const f = await setup();
    const other = await seedFirm(["admin"]);
    await asUser(f.users.author, (c) => createGap(c, f.projectId, "SYNTHETIC secret gap text"));
    const seen = await asUser(other.users.admin, (c) => c.query("select 1 from gaps where project_id = $1", [f.projectId]));
    expect(seen.rowCount).toBe(0);
    const audit = await asOwner((c) => c.query("select action, details from audit_events where project_id = $1 and entity_type = 'gap'", [f.projectId]));
    expect(audit.rows[0].action).toBe("gap.created");
    expect(JSON.stringify(audit.rows)).not.toContain("secret gap text");
  });
});
