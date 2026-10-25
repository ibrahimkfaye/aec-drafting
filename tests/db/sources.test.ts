/**
 * Upload rules for migration 0003 (sources, versions, private storage).
 * All data is SYNTHETIC. Storage uploads are simulated the way Supabase Storage
 * performs them: an INSERT into storage.objects as the signed-in user, under RLS.
 */
import { afterAll, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { asOwner, asService, asUser, insertProject, pool, projectInput, seedFirm } from "./helpers";
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

/** The new flow: uploader requests verification, then the WORKER (service role) finishes it. */
async function requestVerification(uploader: string, versionId: string) {
  return asUser(uploader, async (c) =>
    (await c.query("select * from request_upload_verification($1, 'local')", [versionId])).rows[0] as {
      job_id: string;
      request_count: number;
      status: string;
      enqueue: boolean;
    },
  );
}

async function workerFinish(jobId: string, block: string | null = null) {
  return asService(async (c) => {
    await c.query("select * from worker_start_job($1, 'test-run')", [jobId]);
    return (await c.query("select worker_finish_upload($1, $2, $3, $4) as s", [jobId, block ? null : SHA, block ? null : "pdf", block]))
      .rows[0].s as string;
  });
}

/** Request + worker finish, as the uploader. */
async function complete(uploader: string, versionId: string, block: string | null = null) {
  const job = await requestVerification(uploader, versionId);
  return workerFinish(job.job_id, block);
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

    expect(await complete(f.users.author, v.version_id)).toBe("stored");

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
    expect(await complete(f.users.author, v.version_id, "signature_mismatch")).toBe("blocked");
    const read = await asUser(f.users.author, (c) => c.query("select 1 from storage.objects where name = $1", [v.storage_path]));
    expect(read.rowCount).toBe(0);
  });
});

describe("finishing uploads (worker only)", () => {
  shimOnly("a missing object or a size mismatch is recorded as blocked, never stored", async () => {
    const f = await firmWithProject();
    const v = await asUser(f.users.author, (c) => begin(c, f.projectId, { size: 1000 }));
    expect(await complete(f.users.author, v.version_id)).toBe("blocked");
    expect((await asOwner((c) => c.query("select block_reason from source_versions where id = $1", [v.version_id]))).rows[0].block_reason).toBe(
      "missing_upload",
    );
    const v2 = await asUser(f.users.author, (c) => begin(c, f.projectId, { size: 1000 }));
    await asUser(f.users.author, (c) => putObject(c, v2.storage_path!, 999));
    expect(await complete(f.users.author, v2.version_id)).toBe("blocked");
  });

  it("signed-in users can no longer finish uploads themselves (gap S-02 closed)", async () => {
    const f = await firmWithProject();
    const v = await asUser(f.users.author, (c) => begin(c, f.projectId));
    const job = await requestVerification(f.users.author, v.version_id);
    for (const sql of [
      "select worker_start_job($1, null)",
      "select worker_finish_upload($1, repeat('a', 64), 'pdf', null)",
      "select worker_fail_job($1, 'x')",
    ]) {
      await expect(asUser(f.users.author, (c) => c.query(sql, [job.job_id]))).rejects.toThrow(/permission denied/);
    }
    await expect(
      asUser(f.users.author, (c) => c.query("select complete_source_upload($1, repeat('a', 64), 'pdf', null)", [v.version_id])),
    ).rejects.toThrow(/does not exist/);
  });

  it("only the uploader can request verification, and not after it finished", async () => {
    const f = await firmWithProject();
    const v = await asUser(f.users.author, (c) => begin(c, f.projectId));
    await expect(requestVerification(f.users.admin, v.version_id)).rejects.toThrow(/not yours/);
    const blocked = await asUser(f.users.author, (c) => begin(c, f.projectId, { block: "unsupported_type" }));
    await expect(requestVerification(f.users.author, blocked.version_id)).rejects.toThrow(/already finished/);
  });

  shimOnly("verification requests are idempotent; a finished job is not re-queued", async () => {
    const f = await firmWithProject();
    const v = await asUser(f.users.author, (c) => begin(c, f.projectId));
    await asUser(f.users.author, (c) => putObject(c, v.storage_path!));
    const first = await requestVerification(f.users.author, v.version_id);
    const again = await requestVerification(f.users.author, v.version_id);
    expect(first.enqueue).toBe(true);
    // Still queued: re-handing it to the runner is allowed (runner de-duplicates on job + request_count).
    expect(again).toMatchObject({ job_id: first.job_id, enqueue: true, request_count: 1 });
    await asService((c) => c.query("select * from worker_start_job($1, 'run-1')", [first.job_id]));
    expect(await requestVerification(f.users.author, v.version_id)).toMatchObject({ enqueue: false, status: "running" });
    expect(await workerFinish(first.job_id)).toBe("stored");
    // A retried worker run after success changes nothing.
    expect(await workerFinish(first.job_id, "signature_mismatch")).toBe("stored");
    await expect(requestVerification(f.users.author, v.version_id)).rejects.toThrow(/already finished/);
  });

  it("a failed job can be retried by the uploader; attempts and requests are counted", async () => {
    const f = await firmWithProject();
    const v = await asUser(f.users.author, (c) => begin(c, f.projectId));
    const job = await requestVerification(f.users.author, v.version_id);
    await asService(async (c) => {
      await c.query("select * from worker_start_job($1, 'run-1')", [job.job_id]);
      await c.query("select worker_fail_job($1, 'storage_unavailable')", [job.job_id]);
    });
    const failed = await asOwner(async (c) => (await c.query("select * from processing_jobs where id = $1", [job.job_id])).rows[0]);
    expect(failed).toMatchObject({ status: "failed", error_code: "storage_unavailable", attempts: 1, external_run_id: "run-1" });
    const retry = await requestVerification(f.users.author, v.version_id);
    expect(retry).toMatchObject({ job_id: job.job_id, enqueue: true, request_count: 2, status: "queued" });
  });

  it("firm members can see job status; other firms cannot; jobs cannot be deleted", async () => {
    const f = await firmWithProject();
    const other = await seedFirm(["admin"]);
    const v = await asUser(f.users.author, (c) => begin(c, f.projectId));
    const job = await requestVerification(f.users.author, v.version_id);
    const own = await asUser(f.users.viewer, (c) => c.query("select status from processing_jobs where id = $1", [job.job_id]));
    expect(own.rows[0].status).toBe("queued");
    const foreign = await asUser(other.users.admin, (c) => c.query("select 1 from processing_jobs where id = $1", [job.job_id]));
    expect(foreign.rowCount).toBe(0);
    await expect(asOwner((c) => c.query("delete from processing_jobs where id = $1", [job.job_id]))).rejects.toThrow(/append-only/);
    await expect(
      asUser(f.users.admin, (c) => c.query("update processing_jobs set status = 'succeeded' where id = $1", [job.job_id])),
    ).rejects.toThrow(/permission denied/);
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
