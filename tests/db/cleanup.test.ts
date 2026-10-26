/**
 * Cleanup of blocked / abandoned upload bytes (migration 0009). All data is SYNTHETIC.
 * Object rows are inserted directly only on the test shim (on real Supabase the
 * Storage service owns that table; the end-to-end test covers the real deletion).
 */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { asOwner, asService, asUser, insertProject, pool, projectInput, seedFirm } from "./helpers";
import { testTarget } from "./config";

afterAll(async () => {
  await pool.end();
});

const shimOnly = testTarget() === "shim" ? it : it.skip;

async function firm() {
  const f = await seedFirm();
  const p = await asUser(f.users.author, (c) => insertProject(c, projectInput(f.orgId, f.users.author)));
  return { ...f, projectId: p.id as string };
}

type Status = "uploading" | "stored" | "blocked";

/** Inserts a SYNTHETIC version directly (as owner) with the given status and age. */
async function version(f: Awaited<ReturnType<typeof firm>>, status: Status, ageHours = 0) {
  const sourceId = randomUUID();
  const id = randomUUID();
  const path = `${f.orgId}/${f.projectId}/${sourceId}/${id}`;
  await asOwner(async (c) => {
    await c.query("insert into sources (id, org_id, project_id, title, created_by) values ($1,$2,$3,'SYNTHETIC.pdf',$4)", [
      sourceId,
      f.orgId,
      f.projectId,
      f.users.author,
    ]);
    await c.query(
      `insert into source_versions (id, org_id, project_id, source_id, version_number, original_filename, byte_size,
         detected_type, sha256, storage_path, status, block_reason, uploaded_by, created_at, completed_at)
       values ($1,$2,$3,$4,1,'SYNTHETIC.pdf',100,$5,$6,$7,$8,$9,$10, now() - make_interval(hours => $11), $12)`,
      [
        id,
        f.orgId,
        f.projectId,
        sourceId,
        status === "stored" ? "pdf" : null,
        status === "stored" ? "c".repeat(64) : null,
        path,
        status,
        status === "blocked" ? "signature_mismatch" : null,
        f.users.author,
        ageHours,
        status === "uploading" ? null : new Date(),
      ],
    );
  });
  return { id, path };
}

const putObject = (path: string) =>
  asOwner((c) => c.query("insert into storage.objects (bucket_id, name, metadata) values ('project-files', $1, '{\"size\":100}')", [path]));
const dropObject = (path: string) => asOwner((c) => c.query("delete from storage.objects where name = $1", [path]));

const toClear = (versionId: string | null = null) =>
  asService(async (c) => (await c.query("select * from worker_bytes_to_clear($1, 1000)", [versionId])).rows as { version_id: string; storage_path: string }[]);
const record = (versionId: string) =>
  asService(async (c) => (await c.query("select worker_record_bytes_cleared($1) as r", [versionId])).rows[0].r as boolean);
const blockAbandoned = (interval: string) =>
  asService(async (c) => (await c.query("select worker_block_abandoned_uploads($1::interval) as n", [interval])).rows[0].n as number);

describe("cleanup permissions", () => {
  it("signed-in users (even admins) cannot call the cleanup functions or write the record", async () => {
    const f = await firm();
    const v = await version(f, "blocked");
    for (const sql of [
      "select * from worker_bytes_to_clear(null, 10)",
      "select worker_record_bytes_cleared($1)",
      "select worker_block_abandoned_uploads('48 hours')",
    ]) {
      await expect(asUser(f.users.admin, (c) => c.query(sql, sql.includes("$1") ? [v.id] : []))).rejects.toThrow(/permission denied/);
    }
    await expect(
      asUser(f.users.admin, (c) =>
        c.query("insert into source_bytes_cleared (source_version_id, org_id, project_id) values ($1,$2,$3)", [v.id, f.orgId, f.projectId]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("what may be cleared", () => {
  it("stored and in-progress files are never listed and cannot be recorded as cleared", async () => {
    const f = await firm();
    const stored = await version(f, "stored");
    const uploading = await version(f, "uploading");
    expect(await toClear(stored.id)).toEqual([]);
    expect(await toClear(uploading.id)).toEqual([]);
    await expect(record(stored.id)).rejects.toThrow(/only blocked files/);
    await expect(record(uploading.id)).rejects.toThrow(/only blocked files/);
  });

  it("a blocked file with no stored object is listed once, then recorded and no longer listed", async () => {
    const f = await firm();
    const v = await version(f, "blocked");
    expect(await toClear(v.id)).toEqual([{ version_id: v.id, storage_path: v.path }]);
    expect(await record(v.id)).toBe(true);
    expect(await record(v.id)).toBe(false); // idempotent
    expect(await toClear(v.id)).toEqual([]);
  });

  shimOnly("a blocked file's bytes must really be gone before it can be recorded; re-sent bytes are listed again", async () => {
    const f = await firm();
    const v = await version(f, "blocked");
    await putObject(v.path);
    expect(await toClear(v.id)).toHaveLength(1);
    await expect(record(v.id)).rejects.toThrow(/still present/);
    await dropObject(v.path);
    expect(await record(v.id)).toBe(true);
    expect(await toClear(v.id)).toEqual([]);

    await putObject(v.path); // bytes re-sent while an upload link was still valid
    expect(await toClear(v.id)).toHaveLength(1);
    await dropObject(v.path);
    expect(await record(v.id)).toBe(false);
  });

  it("the record is visible to the firm only, cannot be changed, and is audited without file names", async () => {
    const f = await firm();
    const other = await seedFirm(["admin"]);
    const v = await version(f, "blocked");
    await record(v.id);
    const own = await asUser(f.users.viewer, (c) => c.query("select 1 from source_bytes_cleared where source_version_id = $1", [v.id]));
    expect(own.rowCount).toBe(1);
    const theirs = await asUser(other.users.admin, (c) => c.query("select 1 from source_bytes_cleared where source_version_id = $1", [v.id]));
    expect(theirs.rowCount).toBe(0);
    await expect(asOwner((c) => c.query("delete from source_bytes_cleared where source_version_id = $1", [v.id]))).rejects.toThrow();
    const audit = await asUser(f.users.viewer, (c) =>
      c.query("select action, actor_type, details from audit_events where entity_id = $1 and action = 'source_version.bytes_cleared'", [v.id]),
    );
    expect(audit.rows).toEqual([{ action: "source_version.bytes_cleared", actor_type: "system", details: {} }]);
  });
});

describe("abandoned uploads", () => {
  it("refuses a threshold under 24 hours", async () => {
    await expect(blockAbandoned("3 hours")).rejects.toThrow(/at least 24 hours/);
  });

  it("blocks only old uploads with no verification in progress", async () => {
    const f = await firm();
    const old = await version(f, "uploading", 30);
    const recent = await version(f, "uploading", 1);
    const oldButVerifying = await version(f, "uploading", 30);
    await asUser(f.users.author, (c) => c.query("select * from request_upload_verification($1, 'local')", [oldButVerifying.id]));

    expect(await blockAbandoned("24 hours")).toBeGreaterThanOrEqual(1);
    const { rows } = await asOwner((c) =>
      c.query("select id, status, block_reason from source_versions where id = any($1)", [[old.id, recent.id, oldButVerifying.id]]),
    );
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId[old.id]).toMatchObject({ status: "blocked", block_reason: "abandoned_upload" });
    expect(byId[recent.id].status).toBe("uploading");
    expect(byId[oldButVerifying.id].status).toBe("uploading");

    // Once blocked it is cleared like any other blocked file.
    expect(await toClear(old.id)).toHaveLength(1);
    expect(await record(old.id)).toBe(true);
    const audit = await asUser(f.users.viewer, (c) =>
      c.query("select details from audit_events where entity_id = $1 and action = 'source_version.blocked'", [old.id]),
    );
    expect(audit.rows[0].details.block_reason).toBe("abandoned_upload");
  });
});
