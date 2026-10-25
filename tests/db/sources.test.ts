/**
 * Upload rules for migration 0003 (sources, versions, private storage).
 * All data is SYNTHETIC. Storage uploads are simulated the way Supabase Storage
 * performs them: an INSERT into storage.objects as the signed-in user, under RLS.
 */
import { afterAll, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { asOwner, asUser, insertProject, pool, projectInput, seedFirm } from "./helpers";
import { testTarget } from "./config";

afterAll(async () => {
  await pool.end();
});

const SHA = "a".repeat(64);

type Begin = { source_id: string; version_id: string; version_number: number; storage_path: string | null; status: string };

async function begin(c: PoolClient, projectId: string, opts: { sourceId?: string; size?: number; block?: string } = {}) {
  const { rows } = await c.query<Begin>("select * from begin_source_upload($1, $2, $3, $4, $5, $6)", [
    projectId,
    opts.sourceId ?? null,
    "SYNTHETIC survey notes.pdf",
    opts.size ?? 1000,
    "application/pdf",
    opts.block ?? null,
  ]);
  return rows[0];
}

/** Simulates Supabase Storage writing the object row as the uploading user. */
async function putObject(c: PoolClient, path: string, size = 1000) {
  await c.query("insert into storage.objects (bucket_id, name, owner, metadata) values ('project-files', $1, auth.uid(), $2)", [
    path,
    JSON.stringify({ size, mimetype: "application/pdf" }),
  ]);
}

async function complete(c: PoolClient, versionId: string, block: string | null = null) {
  const { rows } = await c.query("select complete_source_upload($1, $2, $3, $4) as s", [
    versionId,
    block ? null : SHA,
    block ? null : "pdf",
    block,
  ]);
  return rows[0].s as string;
}

async function firmWithProject() {
  const f = await seedFirm();
  const p = await asUser(f.users.author, (c) => insertProject(c, projectInput(f.orgId, f.users.author)));
  return { ...f, projectId: p.id as string };
}

// Storage policies only run in the shim: on real Supabase the test cannot insert
// object rows directly (the Storage service owns that table). They are covered
// there by the end-to-end upload tests instead.
const shimOnly = testTarget() === "shim" ? it : it.skip;

describe("starting uploads", () => {
  it("author can start an upload; version numbers increase per source", async () => {
    const f = await firmWithProject();
    const v1 = await asUser(f.users.author, (c) => begin(c, f.projectId));
    expect(v1).toMatchObject({ version_number: 1, status: "uploading" });
    expect(v1.storage_path).toBe(`${f.orgId}/${f.projectId}/${v1.source_id}/${v1.version_id}`);
    const v2 = await asUser(f.users.admin, (c) => begin(c, f.projectId, { sourceId: v1.source_id }));
    expect(v2).toMatchObject({ source_id: v1.source_id, version_number: 2 });
  });

  it.each(["reviewer", "viewer"] as const)("%s cannot upload", async (role) => {
    const f = await firmWithProject();
    await expect(asUser(f.users[role], (c) => begin(c, f.projectId))).rejects.toThrow(/not found or not allowed/);
  });

  it("another firm cannot upload into this project, or add versions to its sources", async () => {
    const f = await firmWithProject();
    const other = await seedFirm(["author"]);
    await expect(asUser(other.users.author, (c) => begin(c, f.projectId))).rejects.toThrow(/not found or not allowed/);

    const v1 = await asUser(f.users.author, (c) => begin(c, f.projectId));
    const otherProject = await asUser(other.users.author, (c) =>
      insertProject(c, projectInput(other.orgId, other.users.author)),
    );
    await expect(
      asUser(other.users.author, (c) => begin(c, otherProject.id, { sourceId: v1.source_id })),
    ).rejects.toThrow(/source not found in this project/);
  });

  it("archived projects cannot receive uploads", async () => {
    const f = await firmWithProject();
    await asUser(f.users.author, (c) => c.query("update projects set status = 'archived' where id = $1", [f.projectId]));
    await expect(asUser(f.users.author, (c) => begin(c, f.projectId))).rejects.toThrow(/archived/);
  });

  it("oversized or empty files can only be recorded as blocked, never stored", async () => {
    const f = await firmWithProject();
    await expect(asUser(f.users.author, (c) => begin(c, f.projectId, { size: 26214401 }))).rejects.toThrow(/25 MB/);
    await expect(asUser(f.users.author, (c) => begin(c, f.projectId, { size: 0 }))).rejects.toThrow(/25 MB/);
    const blocked = await asUser(f.users.author, (c) => begin(c, f.projectId, { size: 26214401, block: "too_large" }));
    expect(blocked).toMatchObject({ status: "blocked", storage_path: null });
  });

  it("signed-out callers cannot use the upload functions", async () => {
    const f = await firmWithProject();
    await expect(asUser(null, (c) => begin(c, f.projectId))).rejects.toThrow(/permission denied/);
  });
});

describe("storage access", () => {
  shimOnly("only the uploader may write, only to their own in-progress path", async () => {
    const f = await firmWithProject();
    const v = await asUser(f.users.author, (c) => begin(c, f.projectId));
    // Another member of the same firm cannot write to that path.
    await expect(asUser(f.users.admin, (c) => putObject(c, v.storage_path!))).rejects.toThrow(/row-level security/);
    // The uploader cannot write anywhere else.
    await expect(
      asUser(f.users.author, (c) => putObject(c, `${f.orgId}/${f.projectId}/x/y`)),
    ).rejects.toThrow(/row-level security/);
    await asUser(f.users.author, (c) => putObject(c, v.storage_path!));
  });

  shimOnly("stored files are readable by the firm only; overwriting is impossible", async () => {
    const f = await firmWithProject();
    const other = await seedFirm(["admin"]);
    const v = await asUser(f.users.author, (c) => begin(c, f.projectId));
    await asUser(f.users.author, (c) => putObject(c, v.storage_path!));

    // Before completion: only the uploader can read it.
    const viewerBefore = await asUser(f.users.viewer, (c) => c.query("select 1 from storage.objects where name = $1", [v.storage_path]));
    expect(viewerBefore.rowCount).toBe(0);

    expect(await asUser(f.users.author, (c) => complete(c, v.version_id))).toBe("stored");

    const viewerAfter = await asUser(f.users.viewer, (c) => c.query("select 1 from storage.objects where name = $1", [v.storage_path]));
    expect(viewerAfter.rowCount).toBe(1);
    const otherFirm = await asUser(other.users.admin, (c) => c.query("select 1 from storage.objects where name = $1", [v.storage_path]));
    expect(otherFirm.rowCount).toBe(0);

    // Upload slot is closed once stored.
    await expect(asUser(f.users.author, (c) => putObject(c, v.storage_path!))).rejects.toThrow(/row-level security|duplicate/);
    await expect(
      asUser(f.users.author, (c) => c.query("update storage.objects set metadata = '{}' where name = $1", [v.storage_path])),
    ).resolves.toMatchObject({ rowCount: 0 });
    await expect(
      asUser(f.users.author, (c) => c.query("delete from storage.objects where name = $1", [v.storage_path])),
    ).resolves.toMatchObject({ rowCount: 0 });
  });

  shimOnly("files that fail checks are never readable", async () => {
    const f = await firmWithProject();
    const v = await asUser(f.users.author, (c) => begin(c, f.projectId));
    await asUser(f.users.author, (c) => putObject(c, v.storage_path!));
    expect(await asUser(f.users.author, (c) => complete(c, v.version_id, "signature_mismatch"))).toBe("blocked");
    const read = await asUser(f.users.author, (c) => c.query("select 1 from storage.objects where name = $1", [v.storage_path]));
    expect(read.rowCount).toBe(0);
  });
});

describe("finishing uploads", () => {
  shimOnly("cannot mark stored without the object, or with a different size", async () => {
    const f = await firmWithProject();
    const v = await asUser(f.users.author, (c) => begin(c, f.projectId, { size: 1000 }));
    await expect(asUser(f.users.author, (c) => complete(c, v.version_id))).rejects.toThrow(/not found in storage/);
    await asUser(f.users.author, (c) => putObject(c, v.storage_path!, 999));
    await expect(asUser(f.users.author, (c) => complete(c, v.version_id))).rejects.toThrow(/does not match/);
  });

  shimOnly("only the uploader can finish, and only once", async () => {
    const f = await firmWithProject();
    const v = await asUser(f.users.author, (c) => begin(c, f.projectId));
    await asUser(f.users.author, (c) => putObject(c, v.storage_path!));
    await expect(asUser(f.users.admin, (c) => complete(c, v.version_id))).rejects.toThrow(/not yours/);
    expect(await asUser(f.users.author, (c) => complete(c, v.version_id))).toBe("stored");
    await expect(asUser(f.users.author, (c) => complete(c, v.version_id, "invalid_text"))).rejects.toThrow(/already finished/);
  });

  it("a blocked-at-start file cannot later be turned into a stored file", async () => {
    const f = await firmWithProject();
    const v = await asUser(f.users.author, (c) => begin(c, f.projectId, { block: "unsupported_type" }));
    await expect(asUser(f.users.author, (c) => complete(c, v.version_id))).rejects.toThrow(/already finished/);
  });
});

describe("immutability and audit", () => {
  it("signed-in users cannot edit or delete sources or versions directly", async () => {
    const f = await firmWithProject();
    const v = await asUser(f.users.author, (c) => begin(c, f.projectId));
    for (const sql of [
      "update source_versions set status = 'stored' where id = $1",
      "delete from source_versions where id = $1",
      "update sources set title = 'x' where id = (select source_id from source_versions where id = $1)",
    ]) {
      await expect(asUser(f.users.admin, (c) => c.query(sql, [v.version_id]))).rejects.toThrow(/permission denied/);
    }
  });

  it("even the database owner cannot rewrite a finished version or delete one", async () => {
    const f = await firmWithProject();
    const v = await asUser(f.users.author, (c) => begin(c, f.projectId, { block: "unsupported_type" }));
    await expect(
      asOwner((c) => c.query("update source_versions set status = 'uploading' where id = $1", [v.version_id])),
    ).rejects.toThrow();
    await expect(
      asOwner((c) => c.query("update source_versions set original_filename = 'x' where id = $1", [v.version_id])),
    ).rejects.toThrow(/immutable/);
    await expect(asOwner((c) => c.query("delete from source_versions where id = $1", [v.version_id]))).rejects.toThrow(
      /cannot be deleted/,
    );
  });

  it("concurrent uploads to one source get distinct version numbers", async () => {
    const f = await firmWithProject();
    const v1 = await asUser(f.users.author, (c) => begin(c, f.projectId));
    const results = await Promise.all(
      [f.users.author, f.users.admin, f.users.author].map((u) => asUser(u, (c) => begin(c, f.projectId, { sourceId: v1.source_id }))),
    );
    expect(results.map((r) => r.version_number).sort()).toEqual([2, 3, 4]);
  });

  it("records upload events without filenames", async () => {
    const f = await firmWithProject();
    await asUser(f.users.author, (c) => begin(c, f.projectId, { block: "unsupported_type" }));
    const { rows } = await asUser(f.users.viewer, (c) =>
      c.query("select action, details from audit_events where project_id = $1 and entity_type = 'source_version'", [f.projectId]),
    );
    expect(rows[0].action).toBe("source_version.blocked");
    expect(rows[0].details.block_reason).toBe("unsupported_type");
    expect(JSON.stringify(rows)).not.toContain("SYNTHETIC survey notes");
  });
});
