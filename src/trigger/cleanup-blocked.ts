/**
 * Scheduled Trigger.dev task (runs in the Trigger.dev worker, NOT the web app):
 * hourly sweep that clears bytes of blocked and abandoned uploads.
 * Status: written against @trigger.dev/sdk 4.8.1 types; NOT yet run against a real project.
 * Locally, run `npm run cleanup:blocked` instead.
 */
import { schedules } from "@trigger.dev/sdk";
import { runCleanupSweep } from "../lib/jobs/clear-blocked";

export const cleanupBlockedTask = schedules.task({
  id: "cleanup-blocked-files",
  cron: "17 * * * *",
  maxDuration: 300,
  run: async () => runCleanupSweep(),
});
