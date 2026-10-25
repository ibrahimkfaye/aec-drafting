import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { deployEnv, jobRunner } = await import("@/lib/server-env");

const KEYS = ["VERCEL_ENV", "JOB_RUNNER", "SUPABASE_SECRET_KEY", "TRIGGER_SECRET_KEY", "NEXT_PUBLIC_SUPABASE_URL"];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
function setEnv(vars: Record<string, string | undefined>) {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, vars);
}
afterEach(() => setEnv(saved));

describe("deployment environment rules", () => {
  it("defaults to the local runner on your machine", () => {
    setEnv({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SECRET_KEY: "local-secret" });
    expect(deployEnv()).toBe("local");
    expect(jobRunner()).toBe("local");
  });

  it.each(["preview", "production"])("%s: defaults to Trigger.dev and needs its key", (env) => {
    setEnv({ VERCEL_ENV: env, NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co" });
    expect(() => jobRunner()).toThrow(/TRIGGER_SECRET_KEY/);
    process.env.TRIGGER_SECRET_KEY = "tr_x";
    expect(jobRunner()).toBe("trigger");
  });

  it.each(["preview", "production"])("%s: refuses the local runner", (env) => {
    setEnv({ VERCEL_ENV: env, JOB_RUNNER: "local", NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co" });
    expect(() => jobRunner()).toThrow(/not allowed on Vercel/);
  });

  it.each(["preview", "production"])("%s: refuses a Supabase secret key on Vercel", (env) => {
    setEnv({
      VERCEL_ENV: env,
      TRIGGER_SECRET_KEY: "tr_x",
      SUPABASE_SECRET_KEY: "sb_secret_x",
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    });
    expect(() => jobRunner()).toThrow(/must not be set on Vercel/);
  });

  it("refuses a Vercel deployment pointed at local Supabase", () => {
    setEnv({ VERCEL_ENV: "preview", TRIGGER_SECRET_KEY: "tr_x", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" });
    expect(() => jobRunner()).toThrow(/local Supabase URL/);
  });

  it("rejects unknown runner names", () => {
    setEnv({ JOB_RUNNER: "cron" });
    expect(() => jobRunner()).toThrow(/Unknown JOB_RUNNER/);
  });
});
