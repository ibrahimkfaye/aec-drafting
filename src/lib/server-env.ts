import "server-only";

/**
 * Deployment environment rules (see docs/ARCHITECTURE.md "Deployment").
 *   local       your Mac (`npm run dev`), local Supabase, local job runner
 *   preview     Vercel preview deployments → separate staging Supabase + Trigger.dev staging
 *   production  Vercel production → separate production Supabase + Trigger.dev prod
 */
export type DeployEnv = "local" | "preview" | "production";
export type JobRunner = "local" | "trigger";

export function deployEnv(): DeployEnv {
  const v = process.env.VERCEL_ENV;
  if (v === "production") return "production";
  if (v === "preview") return "preview";
  return "local"; // includes `vercel dev` (VERCEL_ENV=development)
}

const isLocalUrl = (u: string | undefined) => !!u && ["localhost", "127.0.0.1"].includes(new URL(u).hostname);

/** Which runner executes background jobs. Throws on unsafe combinations instead of guessing. */
export function jobRunner(): JobRunner {
  const env = deployEnv();
  const runner = process.env.JOB_RUNNER ?? (env === "local" ? "local" : "trigger");
  if (runner !== "local" && runner !== "trigger") throw new Error(`Unknown JOB_RUNNER "${runner}".`);
  if (env !== "local") {
    if (runner === "local") throw new Error("JOB_RUNNER=local is not allowed on Vercel. Use Trigger.dev.");
    if (process.env.SUPABASE_SECRET_KEY) {
      throw new Error("SUPABASE_SECRET_KEY must not be set on Vercel. It belongs only to the Trigger.dev worker.");
    }
    if (isLocalUrl(process.env.NEXT_PUBLIC_SUPABASE_URL)) {
      throw new Error("A Vercel deployment is pointing at a local Supabase URL.");
    }
  }
  if (runner === "trigger" && !process.env.TRIGGER_SECRET_KEY) {
    throw new Error("JOB_RUNNER=trigger needs TRIGGER_SECRET_KEY (server-side only).");
  }
  return runner;
}
