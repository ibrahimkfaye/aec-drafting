import { defineConfig } from "@trigger.dev/sdk";

/**
 * Trigger.dev project config. NOT CONNECTED YET: no Trigger.dev project exists.
 * Creating one (and its dev/staging/prod environments) needs the founder's approval.
 */
export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF ?? "proj_not_configured",
  dirs: ["./src/trigger"],
  maxDuration: 300,
});
