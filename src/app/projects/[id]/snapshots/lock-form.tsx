"use client";

import { useActionState } from "react";
import { lockSnapshot, type LockState } from "./actions";

export function LockForm({ projectId, fingerprint, nextNumber }: { projectId: string; fingerprint: string; nextNumber: number }) {
  const [state, action, pending] = useActionState<LockState, FormData>(lockSnapshot, { status: "idle" });
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="fingerprint" value={fingerprint} />
      <label htmlFor="snapshot-note" className="text-sm font-medium">
        Note (optional)
      </label>
      <textarea id="snapshot-note" name="note" rows={2} defaultValue={state.note} className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm" />
      {state.message && (
        <p role="alert" data-testid="lock-error" className="text-sm text-red-700">
          {state.message}
        </p>
      )}
      <div>
        <button type="submit" disabled={pending} className="rounded bg-zinc-900 px-4 py-1.5 text-sm text-white disabled:opacity-50">
          {pending ? "Locking…" : `Lock snapshot ${nextNumber}`}
        </button>
      </div>
      <p className="text-xs text-zinc-500">Once locked, this snapshot can never be changed. Later edits go into the next snapshot.</p>
    </form>
  );
}
