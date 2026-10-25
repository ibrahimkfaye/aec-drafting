/**
 * Trigger.dev task (runs in the Trigger.dev worker, NOT on Vercel).
 * Status: written against @trigger.dev/sdk 4.8.1 types; NOT yet run against a
 * real Trigger.dev project (none is configured — see docs/ARCHITECTURE.md).
 */
import { task } from "@trigger.dev/sdk";
import { errorCode, failJob, runUploadVerification } from "../lib/jobs/verify-upload";

export const verifyUploadTask = task({
  id: "verify-upload",
  maxDuration: 300,
  retry: { maxAttempts: 3 },
  run: async (payload: { jobId: string }, { ctx }) => {
    const result = await runUploadVerification(payload.jobId, ctx.run.id);
    return { result };
  },
  // Called once all retries are used up: record a visible failure the user can retry.
  onFailure: async ({ payload, error }) => {
    await failJob(payload.jobId, errorCode(error));
  },
});
