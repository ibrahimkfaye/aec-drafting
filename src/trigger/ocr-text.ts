/**
 * Trigger.dev task (runs in the Trigger.dev worker, NOT the web app).
 * Status: written against @trigger.dev/sdk 4.8.1 types; NOT yet run against a real project.
 * OCR is CPU-heavy (seconds per page); maxDuration allows ~200 pages. Compute cost
 * on Trigger.dev must be checked before enabling (see docs/ASSUMPTIONS.md U-07).
 */
import { task } from "@trigger.dev/sdk";
import { errorCode } from "../lib/jobs/errors";
import { failJob } from "../lib/jobs/verify-upload";
import { runOcr } from "../lib/jobs/ocr-text";

export const ocrTextTask = task({
  id: "ocr-text",
  maxDuration: 1800,
  retry: { maxAttempts: 2 },
  run: async (payload: { jobId: string }, { ctx }) => ({ result: await runOcr(payload.jobId, ctx.run.id) }),
  onFailure: async ({ payload, error }) => {
    await failJob(payload.jobId, errorCode(error));
  },
});
