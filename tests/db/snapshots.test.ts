/**
 * Evidence snapshots (migration 0007). All data is SYNTHETIC.
 */
import { afterAll, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { asOwner, asUser, pool, seedFirm } from "./helpers";
import { cite, createFact, review, revise, setup } from "./fixtures";

afterAll(async () => {
  await pool.end();
});

type Setup = Awaited<ReturnType<typeof setup>>;

async function preview(c: PoolClient, projectId: string) {
  const { rows } = await c.query("select * from preview_evidence_snapshot($1)", [projectId]);
  return {
    fingerprint: rows[0].fingerprint as string,
    pending: rows[0].pending_review as number,
    items: rows.filter((r) => r.item_type !== "summary"),
  };
}

async function lock(c: PoolClient, projectId: string, fingerprint: string, note: string | null = null) {
  const { rows } = await c.query("select * from lock_evidence_snapshot($1, $2, $3)", [projectId, fingerprint, note]);
  return rows[0] as { snapshot_id: string; snapshot_number: number };
}

async function previewAndLock(f: Setup, user = f.users.reviewer) {
  const p = await asUser(user, (c) => preview(c, f.projectId));
  return asUser(user, (c) => lock(c, f.projectId, p.fingerprint));
}

async function approvedFact(f: Setup, statement?: string) {
  const fact = await asUser(f.users.author, (c) => createFact(c, f.projectId, cite(f.versionId), statement));
  await asUser(f.users.reviewer, (c) => review(c, fact.revision_id, "approve"));
  return fact;
}

const items = (snapshotId: string) =>
  asOwner(async (c) => (await c.query("select * from evidence_snapshot_items where snapshot_id = $1", [snapshotId])).rows);

describe("who can lock", () => {
  it.each(["reviewer", "admin"] as const)("%s can lock a snapshot", async (role) => {
    const f = await setup();
    await approvedFact(f);
    const s = await previewAndLock(f, f.users[role]);
    expect(s.snapshot_number).toBe(1);
  });

  it.each(["author", "viewer"] as const)("%s cannot lock", async (role) => {
    const f = await setup();
    await approvedFact(f);
    const p = await asUser(f.users[role], (c) => preview(c, f.projectId)); // everyone can preview
    await expect(asUser(f.users[role], (c) => lock(c, f.projectId, p.fingerprint))).rejects.toThrow(/not allowed/);
  });

  it("another firm can neither preview nor lock", async () => {
    const f = await setup();
    const other = await seedFirm(["admin"]);
    await approvedFact(f);
    await expect(asUser(other.users.admin, (c) => preview(c, f.projectId))).rejects.toThrow(/not allowed/);
    await expect(asUser(other.users.admin, (c) => lock(c, f.projectId, "0".repeat(64)))).rejects.toThrow(/not allowed/);
  });
});

describe("what goes in", () => {
  it("includes current approved facts and open gaps; leaves out candidates, rejected and resolved items", async () => {
    const f = await setup();
    const a = await approvedFact(f);
    const candidate = await asUser(f.users.author, (c) => createFact(c, f.projectId, cite(f.versionId)));
    const rejected = await asUser(f.users.author, (c) => createFact(c, f.projectId, cite(f.versionId)));
    await asUser(f.users.reviewer, (c) => review(c, rejected.revision_id, "reject", "SYNTHETIC wrong"));
    const openGap = (await asUser(f.users.author, (c) => c.query("select create_gap($1, 'SYNTHETIC open gap') as id", [f.projectId]))).rows[0].id;
    const closedGap = (await asUser(f.users.author, (c) => c.query("select create_gap($1, 'SYNTHETIC closed gap') as id", [f.projectId]))).rows[0].id;
    await asUser(f.users.reviewer, (c) => c.query("select close_gap($1, 'dismiss', null, 'SYNTHETIC')", [closedGap]));

    const p = await asUser(f.users.reviewer, (c) => preview(c, f.projectId));
    expect(p.pending).toBe(1);
    const s = await asUser(f.users.reviewer, (c) => lock(c, f.projectId, p.fingerprint, "SYNTHETIC first lock"));
    const got = await items(s.snapshot_id);
    expect(got.filter((i) => i.item_type === "fact").map((i) => i.fact_revision_id)).toEqual([a.revision_id]);
    expect(got.filter((i) => i.item_type === "gap").map((i) => i.gap_id)).toEqual([openGap]);
    expect(got.map((i) => i.fact_id)).not.toContain(candidate.fact_id);
    expect(got.map((i) => i.fact_id)).not.toContain(rejected.fact_id);
  });

  it("records approved facts in an open or lost conflict as excluded, with the reason", async () => {
    const f = await setup();
    const win = await approvedFact(f, "SYNTHETIC: Span 24 m.");
    const lose = await approvedFact(f, "SYNTHETIC: Span 42 m.");
    const x = await approvedFact(f, "SYNTHETIC: Width 9 m.");
    const y = await approvedFact(f, "SYNTHETIC: Width 12 m.");
    const resolved = (await asUser(f.users.author, (c) => c.query("select create_conflict($1, 'SYNTHETIC span', $2::uuid[]) as id", [f.projectId, [win.fact_id, lose.fact_id]]))).rows[0].id;
    await asUser(f.users.reviewer, (c) => c.query("select resolve_conflict($1, $2, 'SYNTHETIC drawing governs')", [resolved, win.fact_id]));
    await asUser(f.users.author, (c) => c.query("select create_conflict($1, 'SYNTHETIC width', $2::uuid[])", [f.projectId, [x.fact_id, y.fact_id]]));

    const s = await previewAndLock(f);
    const got = await items(s.snapshot_id);
    const byFact = Object.fromEntries(got.filter((i) => i.fact_id).map((i) => [i.fact_id, [i.item_type, i.exclusion_reason]]));
    expect(byFact[win.fact_id]).toEqual(["fact", null]);
    expect(byFact[lose.fact_id]).toEqual(["excluded", "lost_conflict"]);
    expect(byFact[x.fact_id]).toEqual(["excluded", "open_conflict"]);
    expect(byFact[y.fact_id]).toEqual(["excluded", "open_conflict"]);
    const row = await asOwner(async (c) => (await c.query("select * from evidence_snapshots where id = $1", [s.snapshot_id])).rows[0]);
    expect(row).toMatchObject({ fact_count: 1, excluded_count: 3, gap_count: 0 });
  });
});

describe("lock rules", () => {
  it("refuses a lock when evidence changed after the preview (stale)", async () => {
    const f = await setup();
    const a = await approvedFact(f);
    const p = await asUser(f.users.reviewer, (c) => preview(c, f.projectId));
    await asUser(f.users.author, (c) => revise(c, a.fact_id, a.revision_id, cite(f.versionId)));
    await expect(asUser(f.users.reviewer, (c) => lock(c, f.projectId, p.fingerprint))).rejects.toThrow(/stale/);
  });

  it("refuses an empty snapshot and one identical to the previous", async () => {
    const f = await setup();
    const p0 = await asUser(f.users.reviewer, (c) => preview(c, f.projectId));
    await expect(asUser(f.users.reviewer, (c) => lock(c, f.projectId, p0.fingerprint))).rejects.toThrow(/at least one approved fact/);
    await approvedFact(f);
    await previewAndLock(f);
    await expect(previewAndLock(f)).rejects.toThrow(/identical to snapshot 1/);
  });

  it("numbers snapshots in order", async () => {
    const f = await setup();
    await approvedFact(f);
    expect((await previewAndLock(f)).snapshot_number).toBe(1);
    await approvedFact(f);
    expect((await previewAndLock(f)).snapshot_number).toBe(2);
  });

  it("archived projects cannot be snapshotted", async () => {
    const f = await setup();
    await approvedFact(f);
    const p = await asUser(f.users.reviewer, (c) => preview(c, f.projectId));
    await asUser(f.users.author, (c) => c.query("update projects set status = 'archived' where id = $1", [f.projectId]));
    await expect(asUser(f.users.reviewer, (c) => lock(c, f.projectId, p.fingerprint))).rejects.toThrow(/archived/);
  });
});

describe("snapshots never change", () => {
  it("later edits, approvals and uploads leave a locked snapshot exactly as it was", async () => {
    const f = await setup();
    const a = await approvedFact(f);
    const s1 = await previewAndLock(f);
    const before = await items(s1.snapshot_id);

    const r2 = await asUser(f.users.author, (c) => revise(c, a.fact_id, a.revision_id, cite(f.versionId)));
    await asUser(f.users.reviewer, (c) => review(c, r2.revision_id, "approve"));
    await approvedFact(f);

    expect(await items(s1.snapshot_id)).toEqual(before);
    const s2 = await previewAndLock(f);
    const after = await items(s2.snapshot_id);
    expect(after.map((i) => i.fact_revision_id)).toContain(r2.revision_id);
    expect(after.map((i) => i.fact_revision_id)).not.toContain(a.revision_id);
  });

  it("nobody can edit or delete snapshots or their items, even the database owner", async () => {
    const f = await setup();
    await approvedFact(f);
    const s = await previewAndLock(f);
    await expect(asOwner((c) => c.query("update evidence_snapshots set note = 'x' where id = $1", [s.snapshot_id]))).rejects.toThrow(/append-only/);
    await expect(asOwner((c) => c.query("delete from evidence_snapshot_items where snapshot_id = $1", [s.snapshot_id]))).rejects.toThrow(/append-only/);
    await expect(
      asUser(f.users.admin, (c) =>
        c.query(
          "insert into evidence_snapshots (org_id, project_id, snapshot_number, locked_by, fact_count, excluded_count, gap_count, fingerprint) values ($1,$2,9,$3,1,0,0,$4)",
          [f.orgId, f.projectId, f.users.admin, "0".repeat(64)],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("consistency under concurrency", () => {
  it("a lock and a simultaneous edit cannot interleave: the snapshot matches what was previewed, or the lock is refused", async () => {
    const f = await setup();
    const a = await approvedFact(f);
    const p = await asUser(f.users.reviewer, (c) => preview(c, f.projectId));
    const [lockResult, editResult] = await Promise.allSettled([
      asUser(f.users.reviewer, (c) => lock(c, f.projectId, p.fingerprint)),
      asUser(f.users.author, (c) => revise(c, a.fact_id, a.revision_id, cite(f.versionId))),
    ]);
    expect(editResult.status).toBe("fulfilled");
    if (lockResult.status === "fulfilled") {
      const got = await items(lockResult.value.snapshot_id);
      expect(got.map((i) => i.fact_revision_id)).toEqual([a.revision_id]); // exactly what was previewed
    } else {
      expect(String(lockResult.reason)).toMatch(/stale/);
    }
  });

  it("two reviewers locking at once get one snapshot (no deadlock, no duplicate)", async () => {
    const f = await setup();
    await approvedFact(f);
    const p = await asUser(f.users.reviewer, (c) => preview(c, f.projectId));
    const results = await Promise.allSettled([
      asUser(f.users.reviewer, (c) => lock(c, f.projectId, p.fingerprint)),
      asUser(f.users.admin, (c) => lock(c, f.projectId, p.fingerprint)),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(String(rejected.reason)).toMatch(/identical to snapshot 1/);
  });

  it("audit records the lock with counts and fingerprint only", async () => {
    const f = await setup();
    await approvedFact(f, "SYNTHETIC secret statement text");
    const s = await previewAndLock(f);
    const { rows } = await asOwner((c) => c.query("select action, details from audit_events where entity_id = $1", [s.snapshot_id]));
    expect(rows[0].action).toBe("snapshot.locked");
    expect(rows[0].details).toMatchObject({ snapshot_number: 1, fact_count: 1 });
    expect(JSON.stringify(rows)).not.toContain("secret statement");
  });
});
