/** Text extraction records (migration 0008). All text is SYNTHETIC. */
import { afterAll, describe, expect, it } from "vitest";
import { asOwner, asService, asUser, pool, seedFirm } from "./helpers";
import { setup, storedVersion } from "./fixtures";

afterAll(async () => {
  await pool.end();
});

const PAGES = JSON.stringify([
  { page: 1, text: "SYNTHETIC page one: span 24 m" },
  { page: 2, text: "" },
  { page: 3, text: "SYNTHETIC page three" },
]);

async function workerExtract(versionId: string, status = "extracted", pages = PAGES) {
  return asService(async (c) => {
    const job = (await c.query("select * from worker_request_extraction($1, 'local')", [versionId])).rows[0];
    await c.query("select * from worker_start_job($1, 'test')", [job.job_id]);
    const r = await c.query("select worker_finish_extraction($1, $2, $3, 'test-extractor 1.0', $4::jsonb) as s", [
      job.job_id,
      status,
      status === "extracted" ? "pdf_text_layer" : "none",
      pages,
    ]);
    return { jobId: job.job_id as string, result: r.rows[0].s as string };
  });
}

describe("extraction outcomes", () => {
  it("stores page text and an outcome with counts; firm members can read it", async () => {
    const f = await setup();
    expect((await workerExtract(f.versionId)).result).toBe("extracted");
    const ex = await asUser(f.users.viewer, (c) => c.query("select * from source_text_extractions where source_version_id = $1", [f.versionId]));
    expect(ex.rows[0]).toMatchObject({ status: "extracted", page_count: 3, pages_with_text: 2, method: "pdf_text_layer" });
    const pages = await asUser(f.users.viewer, (c) =>
      c.query("select page_number, text from source_pages where source_version_id = $1 order by page_number", [f.versionId]),
    );
    expect(pages.rows.map((r) => r.text)).toEqual(["SYNTHETIC page one: span 24 m", "", "SYNTHETIC page three"]);
  });

  it("records needs_ocr without storing any text", async () => {
    const f = await setup();
    expect((await workerExtract(f.versionId, "needs_ocr", JSON.stringify([{ page: 1, text: "" }]))).result).toBe("needs_ocr");
    const pages = await asOwner((c) => c.query("select 1 from source_pages where source_version_id = $1", [f.versionId]));
    expect(pages.rowCount).toBe(0);
  });

  it("is idempotent: a second run changes nothing", async () => {
    const f = await setup();
    const first = await workerExtract(f.versionId);
    const again = await asService(async (c) =>
      (await c.query("select worker_finish_extraction($1, 'extracted', 'pdf_text_layer', 'x', '[]'::jsonb) as s", [first.jobId])).rows[0].s,
    );
    expect(again).toBe("already_extracted");
    const n = await asOwner((c) => c.query("select count(*)::int as n from source_pages where source_version_id = $1", [f.versionId]));
    expect(n.rows[0].n).toBe(3);
  });

  it("only stored files can have text extracted", async () => {
    const f = await setup();
    const blocked = await storedVersion(f.orgId, f.projectId, f.users.author, "blocked");
    await expect(asService((c) => c.query("select * from worker_request_extraction($1, 'local')", [blocked]))).rejects.toThrow(
      /only stored files/,
    );
  });
});

describe("who can do what", () => {
  it("admins and authors can request extraction; reviewers, viewers and other firms cannot", async () => {
    const f = await setup();
    const other = await seedFirm(["admin"]);
    const req = (u: string) => asUser(u, (c) => c.query("select * from request_text_extraction($1, 'local')", [f.versionId]));
    expect((await req(f.users.author)).rows[0].enqueue).toBe(true);
    expect((await req(f.users.admin)).rows[0]).toMatchObject({ enqueue: true, request_count: 1 }); // same job, still queued
    await expect(req(f.users.reviewer)).rejects.toThrow(/not allowed/);
    await expect(req(f.users.viewer)).rejects.toThrow(/not allowed/);
    await expect(req(other.users.admin)).rejects.toThrow(/not allowed/);
  });

  it("only the worker can record extracted text", async () => {
    const f = await setup();
    const job = (await asUser(f.users.author, (c) => c.query("select * from request_text_extraction($1, 'local')", [f.versionId]))).rows[0];
    await expect(
      asUser(f.users.admin, (c) =>
        c.query("select worker_finish_extraction($1, 'extracted', 'pdf_text_layer', 'x', '[]'::jsonb)", [job.job_id]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(f.users.admin, (c) =>
        c.query("insert into source_pages (source_version_id, org_id, project_id, page_number, text) values ($1,$2,$3,1,'forged')", [
          f.versionId,
          f.orgId,
          f.projectId,
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("other firms cannot read extracted text; nobody can edit it", async () => {
    const f = await setup();
    const other = await seedFirm(["admin"]);
    await workerExtract(f.versionId);
    const seen = await asUser(other.users.admin, (c) => c.query("select 1 from source_pages where source_version_id = $1", [f.versionId]));
    expect(seen.rowCount).toBe(0);
    await expect(asOwner((c) => c.query("update source_pages set text = 'x' where source_version_id = $1", [f.versionId]))).rejects.toThrow(
      /append-only/,
    );
  });

  it("audit records counts, never text", async () => {
    const f = await setup();
    await workerExtract(f.versionId);
    const { rows } = await asOwner((c) =>
      c.query("select action, details from audit_events where entity_id = $1 and action like 'source_text.%'", [f.versionId]),
    );
    expect(rows[0]).toMatchObject({ action: "source_text.extracted", details: { page_count: 3, pages_with_text: 2 } });
    expect(JSON.stringify(rows)).not.toContain("span 24");
  });
});
