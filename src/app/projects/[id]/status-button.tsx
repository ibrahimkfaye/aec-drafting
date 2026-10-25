"use client";

import { useActionState } from "react";
import { setProjectStatus, type StatusFormState } from "../actions";

export function StatusButton({ id, rowVersion, archived }: { id: string; rowVersion: number; archived: boolean }) {
  const [state, action, pending] = useActionState<StatusFormState, FormData>(setProjectStatus, { status: "idle" });
  return (
    <form action={action} className="flex flex-col items-end gap-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="row_version" value={rowVersion} />
      <input type="hidden" name="next_status" value={archived ? "active" : "archived"} />
      <button type="submit" disabled={pending} className="rounded border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-50">
        {archived ? "Restore project" : "Archive project"}
      </button>
      {state.message && (
        <p role="alert" data-testid="status-error" className="max-w-xs text-right text-sm text-red-700">
          {state.message}
        </p>
      )}
    </form>
  );
}
