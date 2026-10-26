/** OCR records (migration 0010). All text is SYNTHETIC. */
import { afterAll, describe, expect, it } from "vitest";
import { asOwner, asService, asUser, pool, seedFirm } from "./helpers";
import { setup } from "./fixtures";

afterAll(async () => {
  await pool.end();
});

/** The worker's text extraction found (or did not find) a text layer. */
async function extract(versionId: string, status: "extracted" | "needs_ocr") {
  await asService(async (c) => {
    const job = (await c.query("select * from worker_request_extraction($1, 'local')", [versionId])).rows[0];
    await c.query("select * from worker_start_job($1, 'test')", [job.job_id]);
    await c.query("select worker_finish_extraction($1, $2, $3, 'test 1.0', $4::jsonb)", [
      job.job_id,
      status,
      status === "extracted" ? "pdf_text_layer" : "none",
      JSON.stringify(status === "extracted" ? [{ page: 1, text: "SYNTHETIC text layer" }] : []),
    ]);
  });
}

const requestOcr = (userId: string, versionId: string) =>
  asUser(userId, async (c) => (await c.query("select * from request_ocr($1, 'local')", [versionId])).rows[0] as { job_id: string; enqueue: boolean });

const OCR_PAGES = JSON.stringify([
  { page: 1, text: "SYNTHETIC scanned: span 24 m", confidence: 91.5 },
  { page: 2, text: "", confidence: 0 },
  { page: 3, text: "SYNTHETIC page three", confidence: 70.25 },
]);

const finishOcr = (jobId: string, status = "recognized", pages = OCR_PAGES, dpi: number | null = 300) =>
  asService(async (c) => {
    await c.query("select * from worker_start_job($1, 'test')", [jobId]);
    return (
      await c.query("select worker_finish_ocr($1, $2, 'tesseract.js 7.0.0 (eng 4.0.0_best_int)', 'eng', $3, $4::jsonb) as s", [
        jobId,
        status,
        dpi,
        pages,
      ])
    ).rows[0].s as string;
  });

describe("requesting OCR", () => {
  it("admins and authors can request OCR for a file with no text layer; others cannot", async () => {
    const f = await setup();
    await extract(f.versionId, "needs_ocr");
    for (const role of ["reviewer", "viewer"] as const) {
      await expect(requestOcr(f.users[role], f.versionId)).rejects.toThrow(/not found or not allowed/);
    }
    const other = await seedFirm(["admin"]);
    await expect(requestOcr(other.users.admin, f.versionId)).rejects.toThrow(/not found or not allowed/);
    const job = await requestOcr(f.users.author, f.versionId);
    expect(job.enqueue).toBe(true);
    const again = await requestOcr(f.users.admin, f.versionId);
    expect(again.job_id).toBe(job.job_id); // one job per file
  });

  it("is refused for files that have a text layer or haven't been extracted", async () => {
    const f = await setup();
    await expect(requestOcr(f.users.author, f.versionId)).rejects.toThrow(/no text layer/);
    await extract(f.versionId, "extracted");
    await expect(requestOcr(f.users.author, f.versionId)).rejects.toThrow(/no text layer/);
  });

  it("users cannot finish OCR or write OCR pages themselves", async () => {
    const f = await setup();
    await extract(f.versionId, "needs_ocr");
    const job = await requestOcr(f.users.author, f.versionId);
    await expect(
      asUser(f.users.admin, (c) => c.query("select worker_finish_ocr($1, 'recognized', 'x', 'eng', 300, '[]'::jsonb)", [job.job_id])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(f.users.admin, (c) =>
        c.query("insert into source_ocr_results (org_id, project_id, source_version_id, job_id, status, engine, language, page_count, pages_with_text) values ($1,$2,$3,$4,'recognized','x','eng',0,0)", [
          f.orgId,
          f.projectId,
          f.versionId,
          job.job_id,
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("OCR outcomes", () => {
  it("stores OCR page text labelled as OCR with per-page confidence, and a summary", async () => {
    const f = await setup();
    await extract(f.versionId, "needs_ocr");
    const job = await requestOcr(f.users.author, f.versionId);
    expect(await finishOcr(job.job_id)).toBe("recognized");

    const pages = await asUser(f.users.viewer, (c) =>
      c.query("select page_number, text, origin, ocr_confidence::float as conf from source_pages where source_version_id = $1 order by page_number", [
        f.versionId,
      ]),
    );
    expect(pages.rows).toEqual([
      { page_number: 1, text: "SYNTHETIC scanned: span 24 m", origin: "ocr", conf: 91.5 },
      { page_number: 2, text: "", origin: "ocr", conf: 0 },
      { page_number: 3, text: "SYNTHETIC page three", origin: "ocr", conf: 70.25 },
    ]);
    const res = await asUser(f.users.viewer, (c) =>
      c.query("select status, page_count, pages_with_text, mean_confidence::float as mean, render_dpi from source_ocr_results where source_version_id = $1", [
        f.versionId,
      ]),
    );
    // Mean over pages that have text only: (91.5 + 70.25) / 2
    expect(res.rows[0]).toEqual({ status: "recognized", page_count: 3, pages_with_text: 2, mean: 80.88, render_dpi: 300 });
    const audit = await asUser(f.users.viewer, (c) =>
      c.query("select details from audit_events where entity_id = $1 and action = 'source_text.ocr_recognized'", [f.versionId]),
    );
    expect(audit.rows[0].details).toEqual({ page_count: 3, pages_with_text: 2, mean_confidence: 80.88 });
    expect(JSON.stringify(audit.rows)).not.toContain("SYNTHETIC");
  });

  it("records 'no text found' without storing pages", async () => {
    const f = await setup();
    await extract(f.versionId, "needs_ocr");
    const job = await requestOcr(f.users.author, f.versionId);
    expect(await finishOcr(job.job_id, "no_text_found", JSON.stringify([{ page: 1, text: "", confidence: 0 }]))).toBe("no_text_found");
    const n = await asOwner((c) => c.query("select count(*)::int as n from source_pages where source_version_id = $1", [f.versionId]));
    expect(n.rows[0].n).toBe(0);
    const r = await asOwner((c) => c.query("select pages_with_text, mean_confidence from source_ocr_results where source_version_id = $1", [f.versionId]));
    expect(r.rows[0]).toEqual({ pages_with_text: 0, mean_confidence: null });
  });

  it("is idempotent and immutable", async () => {
    const f = await setup();
    await extract(f.versionId, "needs_ocr");
    const job = await requestOcr(f.users.author, f.versionId);
    await finishOcr(job.job_id);
    expect(await finishOcr(job.job_id, "recognized", "[]")).toBe("already_done");
    const n = await asOwner((c) => c.query("select count(*)::int as n from source_pages where source_version_id = $1", [f.versionId]));
    expect(n.rows[0].n).toBe(3);
    await expect(asOwner((c) => c.query("update source_ocr_results set status = 'no_text_found' where source_version_id = $1", [f.versionId]))).rejects.toThrow();
    await expect(asOwner((c) => c.query("update source_pages set text = 'x' where source_version_id = $1", [f.versionId]))).rejects.toThrow();
    // A finished request is not re-queued.
    expect((await requestOcr(f.users.author, f.versionId)).enqueue).toBe(false);
  });

  it("rejects confidence outside 0–100 and OCR labels without confidence", async () => {
    const f = await setup();
    await extract(f.versionId, "needs_ocr");
    const job = await requestOcr(f.users.author, f.versionId);
    await expect(finishOcr(job.job_id, "recognized", JSON.stringify([{ page: 1, text: "x", confidence: 101 }]))).rejects.toThrow(/check/);
    await expect(finishOcr(job.job_id, "recognized", JSON.stringify([{ page: 1, text: "x" }]))).rejects.toThrow(/check/);
  });

  it("the worker cannot record OCR text for a file that has a text layer", async () => {
    const f = await setup();
    await extract(f.versionId, "extracted");
    const { rows } = await asOwner((c) =>
      c.query(
        `insert into processing_jobs (org_id, project_id, kind, subject_id, idempotency_key, runner, requested_by)
         values ($1, $2, 'ocr_text', $3::uuid, 'ocr_text:' || $3::text, 'local', $4) returning id`,
        [f.orgId, f.projectId, f.versionId, f.users.author],
      ),
    );
    await expect(finishOcr(rows[0].id)).rejects.toThrow(/no text layer/);
  });

  it("text-layer pages are labelled as such and carry no confidence", async () => {
    const f = await setup();
    await extract(f.versionId, "extracted");
    const p = await asOwner((c) => c.query("select origin, ocr_confidence from source_pages where source_version_id = $1", [f.versionId]));
    expect(p.rows).toEqual([{ origin: "text_layer", ocr_confidence: null }]);
  });
});
