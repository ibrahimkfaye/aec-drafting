/** Cleanup worker logic against a fake service-role client (no network). SYNTHETIC ids. */
import { describe, expect, it } from "vitest";
import { clearBlockedBytes, runCleanupSweep } from "../../src/lib/jobs/clear-blocked";

type Row = { version_id: string; storage_path: string };

function fakeAdmin(opts: { rows: Row[]; removeError?: boolean; recordFailsFor?: string[]; listError?: boolean }) {
  const pending = [...opts.rows];
  const calls = { removed: [] as string[][], recorded: [] as string[], rpc: [] as [string, unknown][] };
  const admin = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.rpc.push([fn, args]);
      if (fn === "worker_bytes_to_clear") {
        if (opts.listError) return { data: null, error: { message: "x" } };
        const id = args.p_version_id as string | null;
        return { data: pending.filter((r) => !id || r.version_id === id).slice(0, args.p_limit as number), error: null };
      }
      if (fn === "worker_record_bytes_cleared") {
        const id = args.p_version_id as string;
        if (opts.recordFailsFor?.includes(id)) return { data: null, error: { message: "still present" } };
        calls.recorded.push(id);
        pending.splice(pending.findIndex((r) => r.version_id === id), 1);
        return { data: true, error: null };
      }
      if (fn === "worker_block_abandoned_uploads") return { data: 2, error: null };
      throw new Error(`unexpected rpc ${fn}`);
    },
    storage: {
      from: () => ({
        remove: async (paths: string[]) => {
          calls.removed.push(paths);
          return opts.removeError ? { data: null, error: { message: "down" } } : { data: [], error: null };
        },
      }),
    },
  };
  return { admin: admin as never, calls };
}

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ version_id: `v${i}`, storage_path: `org/proj/src/v${i}` }));

describe("clearBlockedBytes", () => {
  it("deletes exactly the paths the database lists, then records each one", async () => {
    const { admin, calls } = fakeAdmin({ rows: rows(3) });
    expect(await clearBlockedBytes(admin)).toEqual({ cleared: 3, failed: 0 });
    expect(calls.removed).toEqual([["org/proj/src/v0", "org/proj/src/v1", "org/proj/src/v2"]]);
    expect(calls.recorded).toEqual(["v0", "v1", "v2"]);
  });

  it("works through more than one batch", async () => {
    const { admin, calls } = fakeAdmin({ rows: rows(150) });
    expect(await clearBlockedBytes(admin)).toEqual({ cleared: 150, failed: 0 });
    expect(calls.removed.map((b) => b.length)).toEqual([100, 50]);
  });

  it("limits itself to one version when given an id", async () => {
    const { admin, calls } = fakeAdmin({ rows: rows(3) });
    expect(await clearBlockedBytes(admin, "v1")).toEqual({ cleared: 1, failed: 0 });
    expect(calls.removed).toEqual([["org/proj/src/v1"]]);
  });

  it("records nothing when storage deletion fails, and stops instead of looping", async () => {
    const { admin, calls } = fakeAdmin({ rows: rows(2), removeError: true });
    expect(await clearBlockedBytes(admin)).toEqual({ cleared: 0, failed: 2 });
    expect(calls.recorded).toEqual([]);
    expect(calls.removed).toHaveLength(1);
  });

  it("counts a refused record (bytes still present) as failed", async () => {
    const { admin } = fakeAdmin({ rows: rows(2), recordFailsFor: ["v0"] });
    expect(await clearBlockedBytes(admin)).toEqual({ cleared: 1, failed: 1 });
  });

  it("fails with a code, not a message, when the list can't be read", async () => {
    const { admin } = fakeAdmin({ rows: [], listError: true });
    await expect(clearBlockedBytes(admin)).rejects.toMatchObject({ code: "cleanup_list_failed" });
  });
});

describe("runCleanupSweep", () => {
  it("first blocks uploads abandoned for 24 hours, then clears", async () => {
    const { admin, calls } = fakeAdmin({ rows: rows(1) });
    expect(await runCleanupSweep(admin)).toEqual({ abandoned: 2, cleared: 1, failed: 0 });
    expect(calls.rpc[0]).toEqual(["worker_block_abandoned_uploads", { p_older_than: "24 hours" }]);
  });
});
