/**
 * Fact review rules (migration 0004). All data is SYNTHETIC.
 */
import { afterAll, describe, expect, it } from "vitest";
import { asOwner, asUser, insertProject, pool, projectInput, seedFirm } from "./helpers";
import { cite, createFact, review, revise, revisionRow, setup, storedVersion } from "./fixtures";

afterAll(async () => {
  await pool.end();
});

describe("creating facts", () => {
  it.each(["admin", "author", "reviewer"] as const)("%s can propose a fact; it starts as a candidate", async (role) => {
    const f = await setup();
    const fact = await asUser(f.users[role], (c) => createFact(c, f.projectId, cite(f.versionId)));
    expect(await revisionRow(fact.revision_id)).toMatchObject({ status: "candidate", revision_number: 1 });
  });

  it("viewers and other firms cannot propose facts", async () => {
    const f = await setup();
    const other = await seedFirm(["admin"]);
    await expect(asUser(f.users.viewer, (c) => createFact(c, f.projectId, cite(f.versionId)))).rejects.toThrow(/not allowed/);
    await expect(asUser(other.users.admin, (c) => createFact(c, f.projectId, cite(f.versionId)))).rejects.toThrow(/not allowed/);
  });

  it("citations must point to a stored file in the same project, with a page or section", async () => {
    const f = await setup();
    const otherProject = await asUser(f.users.author, (c) => insertProject(c, projectInput(f.orgId, f.users.author)));
    const elsewhere = await storedVersion(f.orgId, otherProject.id, f.users.author);
    const blocked = await storedVersion(f.orgId, f.projectId, f.users.author, "blocked");

    await expect(asUser(f.users.author, (c) => createFact(c, f.projectId, cite(elsewhere)))).rejects.toThrow(/not found in this project/);
    await expect(asUser(f.users.author, (c) => createFact(c, f.projectId, cite(blocked)))).rejects.toThrow(/only stored files/);
    await expect(
      asUser(f.users.author, (c) => createFact(c, f.projectId, cite(f.versionId, { page: null, section: "" }))),
    ).rejects.toThrow(/check constraint/);
    await expect(
      asUser(f.users.author, (c) => createFact(c, f.projectId, cite(f.versionId, { excerpt: "  " }))),
    ).rejects.toThrow(/check constraint/);
    const ok = await asUser(f.users.author, (c) => createFact(c, f.projectId, cite(f.versionId, { page: null, section: "3.2 Loads" })));
    expect(ok.fact_id).toBeTruthy();
  });

  it("archived projects accept no new facts", async () => {
    const f = await setup();
    await asUser(f.users.author, (c) => c.query("update projects set status = 'archived' where id = $1", [f.projectId]));
    await expect(asUser(f.users.author, (c) => createFact(c, f.projectId, cite(f.versionId)))).rejects.toThrow(/archived/);
  });
});

describe("separation of duties", () => {
  it("a reviewer approves an author's fact", async () => {
    const f = await setup();
    const fact = await asUser(f.users.author, (c) => createFact(c, f.projectId, cite(f.versionId)));
    expect(await asUser(f.users.reviewer, (c) => review(c, fact.revision_id, "approve"))).toBe("approved");
    expect(await revisionRow(fact.revision_id)).toMatchObject({
      status: "approved",
      reviewed_by: f.users.reviewer,
      self_approved: false,
    });
  });

  it("a reviewer cannot approve or reject a fact they wrote", async () => {
    const f = await setup();
    const fact = await asUser(f.users.reviewer, (c) => createFact(c, f.projectId, cite(f.versionId)));
    await expect(asUser(f.users.reviewer, (c) => review(c, fact.revision_id, "approve"))).rejects.toThrow(/separation of duties/);
    await expect(asUser(f.users.reviewer, (c) => review(c, fact.revision_id, "reject", "x"))).rejects.toThrow(/separation of duties/);
  });

  it("an admin may approve their own fact, and it is flagged as self-approved", async () => {
    const f = await setup();
    const fact = await asUser(f.users.admin, (c) => createFact(c, f.projectId, cite(f.versionId)));
    expect(await asUser(f.users.admin, (c) => review(c, fact.revision_id, "approve"))).toBe("approved");
    expect(await revisionRow(fact.revision_id)).toMatchObject({ self_approved: true, reviewed_by: f.users.admin });
    const audit = await asOwner((c) =>
      c.query("select details from audit_events where action = 'fact.approved' and entity_id = $1", [fact.fact_id]),
    );
    expect(audit.rows[0].details.self_approved).toBe(true);
  });

  it.each(["author", "viewer"] as const)("%s cannot approve anything", async (role) => {
    const f = await setup();
    const fact = await asUser(f.users.admin, (c) => createFact(c, f.projectId, cite(f.versionId)));
    await expect(asUser(f.users[role], (c) => review(c, fact.revision_id, "approve"))).rejects.toThrow(/not allowed/);
  });

  it("another firm's reviewer cannot review this firm's facts", async () => {
    const f = await setup();
    const other = await seedFirm(["reviewer"]);
    const fact = await asUser(f.users.author, (c) => createFact(c, f.projectId, cite(f.versionId)));
    await expect(asUser(other.users.reviewer, (c) => review(c, fact.revision_id, "approve"))).rejects.toThrow(/not allowed/);
  });
});

describe("review rules", () => {
  it("a fact with no citation cannot be approved", async () => {
    const f = await setup();
    const fact = await asUser(f.users.author, (c) => createFact(c, f.projectId, "[]"));
    await expect(asUser(f.users.reviewer, (c) => review(c, fact.revision_id, "approve"))).rejects.toThrow(/without a cited source/);
  });

  it("a rejection needs a note", async () => {
    const f = await setup();
    const fact = await asUser(f.users.author, (c) => createFact(c, f.projectId, cite(f.versionId)));
    await expect(asUser(f.users.reviewer, (c) => review(c, fact.revision_id, "reject", " "))).rejects.toThrow(/needs a note/);
    expect(await asUser(f.users.reviewer, (c) => review(c, fact.revision_id, "reject", "Excerpt says 42 m, not 24 m"))).toBe(
      "rejected",
    );
  });

  it("a decision cannot be made twice", async () => {
    const f = await setup();
    const fact = await asUser(f.users.author, (c) => createFact(c, f.projectId, cite(f.versionId)));
    await asUser(f.users.reviewer, (c) => review(c, fact.revision_id, "approve"));
    await expect(asUser(f.users.admin, (c) => review(c, fact.revision_id, "reject", "late"))).rejects.toThrow(/no longer awaiting/);
  });
});

describe("editing and versions", () => {
  it("editing an approved fact creates a new candidate; the approval stays on the old revision only", async () => {
    const f = await setup();
    const fact = await asUser(f.users.author, (c) => createFact(c, f.projectId, cite(f.versionId)));
    await asUser(f.users.reviewer, (c) => review(c, fact.revision_id, "approve"));
    const r2 = await asUser(f.users.author, (c) => revise(c, fact.fact_id, fact.revision_id, cite(f.versionId)));
    expect(r2.revision_number).toBe(2);
    expect(await revisionRow(fact.revision_id)).toMatchObject({ status: "superseded", reviewed_by: f.users.reviewer });
    expect(await revisionRow(r2.revision_id)).toMatchObject({ status: "candidate", reviewed_by: null });
  });

  it("an approval for an outdated revision is refused (stale approval)", async () => {
    const f = await setup();
    const fact = await asUser(f.users.author, (c) => createFact(c, f.projectId, cite(f.versionId)));
    // Reviewer loaded revision 1; meanwhile the author edits it.
    await asUser(f.users.author, (c) => revise(c, fact.fact_id, fact.revision_id, cite(f.versionId)));
    await expect(asUser(f.users.reviewer, (c) => review(c, fact.revision_id, "approve"))).rejects.toThrow(/no longer awaiting/);
  });

  it("an edit based on an outdated revision is refused", async () => {
    const f = await setup();
    const fact = await asUser(f.users.author, (c) => createFact(c, f.projectId, cite(f.versionId)));
    await asUser(f.users.author, (c) => revise(c, fact.fact_id, fact.revision_id, cite(f.versionId)));
    await expect(asUser(f.users.admin, (c) => revise(c, fact.fact_id, fact.revision_id, cite(f.versionId)))).rejects.toThrow(
      /stale/,
    );
  });

  it("approval and a concurrent edit cannot both win", async () => {
    const f = await setup();
    const fact = await asUser(f.users.author, (c) => createFact(c, f.projectId, cite(f.versionId)));
    const results = await Promise.allSettled([
      asUser(f.users.reviewer, (c) => review(c, fact.revision_id, "approve")),
      asUser(f.users.author, (c) => revise(c, fact.fact_id, fact.revision_id, cite(f.versionId))),
    ]);
    const final = await asOwner(
      async (c) =>
        (await c.query("select revision_number, status from fact_revisions where fact_id = $1 order by revision_number", [fact.fact_id]))
          .rows,
    );
    // Either: approved then superseded by r2 (both succeeded, in that order) or r2 first and the approval refused.
    // Never: an approved revision that is not current while nothing superseded it.
    const current = final[final.length - 1];
    expect(current.status).toBe("candidate");
    if (final.length === 2) expect(final[0].status).toBe("superseded");
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
  });

  it("history cannot be rewritten or deleted, even by the database owner", async () => {
    const f = await setup();
    const fact = await asUser(f.users.author, (c) => createFact(c, f.projectId, cite(f.versionId)));
    await asUser(f.users.reviewer, (c) => review(c, fact.revision_id, "approve"));
    await expect(
      asOwner((c) => c.query("update fact_revisions set statement = 'changed' where id = $1", [fact.revision_id])),
    ).rejects.toThrow(/immutable/);
    await expect(
      asOwner((c) => c.query("update fact_revisions set status = 'candidate' where id = $1", [fact.revision_id])),
    ).rejects.toThrow(/invalid fact status/);
    await expect(asOwner((c) => c.query("delete from fact_revisions where id = $1", [fact.revision_id]))).rejects.toThrow(
      /cannot be deleted/,
    );
    await expect(asOwner((c) => c.query("update fact_citations set excerpt = 'x' where fact_revision_id = $1", [fact.revision_id]))).rejects.toThrow(
      /append-only/,
    );
  });

  it("signed-in users have no direct write access", async () => {
    const f = await setup();
    const fact = await asUser(f.users.author, (c) => createFact(c, f.projectId, cite(f.versionId)));
    await expect(
      asUser(f.users.admin, (c) =>
        c.query("update fact_revisions set status = 'approved', reviewed_by = $2, reviewed_at = now() where id = $1", [
          fact.revision_id,
          f.users.admin,
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("audit records events without statement or excerpt text", async () => {
    const f = await setup();
    const fact = await asUser(f.users.author, (c) => createFact(c, f.projectId, cite(f.versionId)));
    await asUser(f.users.reviewer, (c) => review(c, fact.revision_id, "reject", "SYNTHETIC wrong span"));
    const { rows } = await asUser(f.users.viewer, (c) =>
      c.query("select action, details from audit_events where entity_type = 'fact' and entity_id = $1 order by id", [fact.fact_id]),
    );
    expect(rows.map((r) => r.action)).toEqual(["fact.created", "fact.rejected"]);
    expect(JSON.stringify(rows)).not.toMatch(/Span is|span 24|wrong span/);
  });
});
