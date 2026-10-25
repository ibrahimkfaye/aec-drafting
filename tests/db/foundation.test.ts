/**
 * Access-control and integrity tests for migration 0001 (foundation).
 * All firms, users and projects here are SYNTHETIC test data.
 */
import { afterAll, describe, expect, it } from "vitest";
import { asOwner, asUser, insertProject, pool, projectInput, seedFirm } from "./helpers";

afterAll(async () => {
  await pool.end();
});

describe("firm isolation", () => {
  it("a member cannot see another firm's organization, members, projects or audit events", async () => {
    const a = await seedFirm();
    const b = await seedFirm();
    await asUser(b.users.author, (c) => insertProject(c, projectInput(b.orgId, b.users.author)));

    await asUser(a.users.admin, async (c) => {
      const orgs = await c.query("select id from organizations");
      expect(orgs.rows.map((r) => r.id)).toEqual([a.orgId]);
      const members = await c.query("select org_id from memberships where org_id = $1", [b.orgId]);
      expect(members.rowCount).toBe(0);
      const projects = await c.query("select id from projects where org_id = $1", [b.orgId]);
      expect(projects.rowCount).toBe(0);
      const audit = await c.query("select id from audit_events where org_id = $1", [b.orgId]);
      expect(audit.rowCount).toBe(0);
    });
  });

  it("a member cannot create a project inside another firm", async () => {
    const a = await seedFirm();
    const b = await seedFirm();
    await expect(
      asUser(a.users.author, (c) => insertProject(c, projectInput(b.orgId, a.users.author))),
    ).rejects.toThrow(/row-level security/);
  });

  it("a member cannot update another firm's project (silently affects 0 rows)", async () => {
    const a = await seedFirm();
    const b = await seedFirm();
    const p = await asUser(b.users.author, (c) => insertProject(c, projectInput(b.orgId, b.users.author)));
    const res = await asUser(a.users.admin, (c) =>
      c.query("update projects set name = 'hijacked' where id = $1", [p.id]),
    );
    expect(res.rowCount).toBe(0);
    const after = await asOwner((c) => c.query("select name from projects where id = $1", [p.id]));
    expect(after.rows[0].name).toBe("SYNTHETIC Sample Project");
  });

  it("a signed-out (anon) caller cannot read anything", async () => {
    await seedFirm();
    await expect(asUser(null, (c) => c.query("select * from projects"))).rejects.toThrow(/permission denied/);
    await expect(asUser(null, (c) => c.query("select * from organizations"))).rejects.toThrow(/permission denied/);
  });
});

describe("roles", () => {
  it.each(["admin", "author"] as const)("%s can create a project", async (role) => {
    const f = await seedFirm();
    const p = await asUser(f.users[role], (c) => insertProject(c, projectInput(f.orgId, f.users[role])));
    expect(p.org_id).toBe(f.orgId);
    expect(p.row_version).toBe(1);
  });

  it.each(["reviewer", "viewer"] as const)("%s cannot create a project", async (role) => {
    const f = await seedFirm();
    await expect(
      asUser(f.users[role], (c) => insertProject(c, projectInput(f.orgId, f.users[role]))),
    ).rejects.toThrow(/row-level security/);
  });

  it("viewer cannot update a project", async () => {
    const f = await seedFirm();
    const p = await asUser(f.users.author, (c) => insertProject(c, projectInput(f.orgId, f.users.author)));
    const res = await asUser(f.users.viewer, (c) => c.query("update projects set name = 'x' where id = $1", [p.id]));
    expect(res.rowCount).toBe(0);
  });

  it("a user cannot create a project while claiming to be someone else", async () => {
    const f = await seedFirm();
    await expect(
      asUser(f.users.author, (c) => insertProject(c, projectInput(f.orgId, f.users.admin))),
    ).rejects.toThrow(/row-level security/);
  });

  it("no signed-in user can delete a project (archive instead)", async () => {
    const f = await seedFirm();
    const p = await asUser(f.users.admin, (c) => insertProject(c, projectInput(f.orgId, f.users.admin)));
    await expect(
      asUser(f.users.admin, (c) => c.query("delete from projects where id = $1", [p.id])),
    ).rejects.toThrow(/permission denied/);
  });

  it("no signed-in user (even a firm admin) can grant or change roles", async () => {
    const f = await seedFirm();
    await expect(
      asUser(f.users.admin, (c) =>
        c.query("update memberships set role = 'admin' where user_id = $1", [f.users.viewer]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(f.users.viewer, (c) =>
        c.query("insert into memberships (org_id, user_id, role) values ($1, $2, 'admin')", [f.orgId, f.users.viewer]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("pilot rule: a user can belong to only one firm", async () => {
    const a = await seedFirm(["author"]);
    const b = await seedFirm([]);
    await expect(
      asOwner((c) =>
        c.query("insert into memberships (org_id, user_id, role) values ($1, $2, 'author')", [b.orgId, a.users.author]),
      ),
    ).rejects.toThrow(/memberships_single_firm_pilot/);
  });
});

describe("assigned reviewer", () => {
  it("accepts a reviewer or admin from the same firm", async () => {
    const f = await seedFirm();
    for (const r of [f.users.reviewer, f.users.admin]) {
      const p = await asUser(f.users.author, (c) =>
        insertProject(c, projectInput(f.orgId, f.users.author, { assigned_reviewer_id: r })),
      );
      expect(p.assigned_reviewer_id).toBe(r);
    }
  });

  it("rejects a viewer or author as reviewer", async () => {
    const f = await seedFirm();
    for (const r of [f.users.viewer, f.users.author]) {
      await expect(
        asUser(f.users.author, (c) =>
          insertProject(c, projectInput(f.orgId, f.users.author, { assigned_reviewer_id: r })),
        ),
      ).rejects.toThrow(/reviewer or admin/);
    }
  });

  it("rejects a reviewer from a different firm", async () => {
    const a = await seedFirm();
    const b = await seedFirm();
    await expect(
      asUser(a.users.author, (c) =>
        insertProject(c, projectInput(a.orgId, a.users.author, { assigned_reviewer_id: b.users.reviewer })),
      ),
    ).rejects.toThrow(/foreign key|reviewer or admin/);
  });
});

describe("integrity and versioning", () => {
  it("increments row_version on every update and supports optimistic-concurrency checks", async () => {
    const f = await seedFirm();
    const p = await asUser(f.users.author, (c) => insertProject(c, projectInput(f.orgId, f.users.author)));
    const first = await asUser(f.users.author, (c) =>
      c.query("update projects set name = 'v2' where id = $1 and row_version = $2 returning row_version", [p.id, 1]),
    );
    expect(first.rows[0].row_version).toBe(2);
    // A second writer still holding version 1 must not overwrite the newer data.
    const stale = await asUser(f.users.admin, (c) =>
      c.query("update projects set name = 'stale' where id = $1 and row_version = $2", [p.id, 1]),
    );
    expect(stale.rowCount).toBe(0);
  });

  it("cannot move a project to another firm or rewrite its creator", async () => {
    const a = await seedFirm();
    const b = await seedFirm();
    const p = await asUser(a.users.admin, (c) => insertProject(c, projectInput(a.orgId, a.users.admin)));
    await expect(
      asOwner((c) => c.query("update projects set org_id = $1 where id = $2", [b.orgId, p.id])),
    ).rejects.toThrow(/immutable/);
    await expect(
      asUser(a.users.admin, (c) => c.query("update projects set created_by = $1 where id = $2", [a.users.author, p.id])),
    ).rejects.toThrow(/immutable/);
  });
});

describe("audit trail", () => {
  it("records create and update events with the acting user and changed field names only", async () => {
    const f = await seedFirm();
    const p = await asUser(f.users.author, (c) => insertProject(c, projectInput(f.orgId, f.users.author)));
    await asUser(f.users.author, (c) =>
      c.query("update projects set scope_instructions = 'confidential text' where id = $1", [p.id]),
    );
    await asUser(f.users.admin, (c) => c.query("update projects set status = 'archived' where id = $1", [p.id]));

    const { rows } = await asUser(f.users.viewer, (c) =>
      c.query("select action, actor_id, actor_type, details from audit_events where project_id = $1 order by id", [p.id]),
    );
    expect(rows.map((r) => r.action)).toEqual(["project.created", "project.updated", "project.status_changed"]);
    expect(rows[0].actor_id).toBe(f.users.author);
    expect(rows[2].actor_id).toBe(f.users.admin);
    expect(rows[1].details.changed_fields).toEqual(["scope_instructions"]);
    // Audit must not copy document content.
    expect(JSON.stringify(rows)).not.toContain("confidential text");
  });

  it("signed-in users cannot write audit events directly", async () => {
    const f = await seedFirm();
    await expect(
      asUser(f.users.admin, (c) =>
        c.query(
          "insert into audit_events (org_id, actor_id, actor_type, action, entity_type, entity_id) values ($1,$2,'user','fake','x','x')",
          [f.orgId, f.users.admin],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("audit events cannot be updated or deleted, even by the database owner", async () => {
    const f = await seedFirm();
    await asUser(f.users.admin, (c) => insertProject(c, projectInput(f.orgId, f.users.admin)));
    await expect(
      asOwner((c) => c.query("update audit_events set action = 'tampered' where org_id = $1", [f.orgId])),
    ).rejects.toThrow(/append-only/);
    await expect(
      asOwner((c) => c.query("delete from audit_events where org_id = $1", [f.orgId])),
    ).rejects.toThrow(/append-only/);
    await expect(asOwner((c) => c.query("truncate audit_events cascade"))).rejects.toThrow(/append-only/);
  });
});
