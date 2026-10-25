import "server-only";
import { after } from "next/server";
import { tasks } from "@trigger.dev/sdk";
import type { verifyUploadTask } from "@/trigger/verify-upload";
import { jobRunner } from "@/lib/server-env";
import { errorCode, failJob, runUploadVerification } from "./verify-upload";

/**
 * Hands a verification job to the configured runner and returns immediately.
 *   trigger  Trigger.dev (preview/production). Idempotency key = job + request
 *            number, so a repeated hand-off never starts a second run.
 *   local    DEVELOPMENT ONLY: runs inside `npm run dev` after the response is
 *            sent. Refused on Vercel by jobRunner().
 */
export async function enqueueUploadVerification(job: { job_id: string; request_count: number }) {
  const runner = jobRunner();
  if (runner === "local") {
    after(async () => {
      try {
        await runUploadVerification(job.job_id, `local-${job.request_count}`);
      } catch (e) {
        await failJob(job.job_id, errorCode(e));
      }
    });
    return runner;
  }
  await tasks.trigger<typeof verifyUploadTask>(
    "verify-upload",
    { jobId: job.job_id },
    { idempotencyKey: `verify_upload:${job.job_id}:${job.request_count}` },
  );
  return runner;
}
