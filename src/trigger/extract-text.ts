/**
 * Trigger.dev task (runs in the Trigger.dev worker, NOT the web app).
 * Status: written against @trigger.dev/sdk 4.8.1 types; NOT yet run against a real project.
 */
import { task } from "@trigger.dev/sdk";
import { errorCode } from "../lib/jobs/errors";
import { failJob } from "../lib/jobs/verify-upload";
import { runTextExtraction } from "../lib/jobs/extract-text";

export const extractTextTask = task({
  id: "extract-text",
  maxDuration: 300,
  retry: { maxAttempts: 3 },
  run: async (payload: { jobId: string }, { ctx }) => ({ result: await runTextExtraction(payload.jobId, ctx.run.id) }),
  onFailure: async ({ payload, error }) => {
    await failJob(payload.jobId, errorCode(error));
  },
});
