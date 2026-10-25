"use client";

import { useActionState } from "react";
import { reviewFact, type ReviewState } from "./actions";

export function ReviewControls({ projectId, revisionId }: { projectId: string; revisionId: string }) {
  const [state, action, pending] = useActionState<ReviewState, FormData>(reviewFact, { status: "idle" });
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="revision_id" value={revisionId} />
      <label htmlFor={`note-${revisionId}`} className="text-xs text-zinc-600">
        Review note (required to reject)
      </label>
      <textarea id={`note-${revisionId}`} name="note" rows={2} className="w-full rounded border border-zinc-300 px-2 py-1 text-sm" />
      <div className="flex gap-2">
        <button type="submit" name="decision" value="approve" disabled={pending} className="rounded bg-emerald-700 px-3 py-1.5 text-sm text-white disabled:opacity-50">
          Approve
        </button>
        <button type="submit" name="decision" value="reject" disabled={pending} className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-800 disabled:opacity-50">
          Reject
        </button>
      </div>
      {state.message && (
        <p role="alert" data-testid="review-error" className="text-sm text-red-700">
          {state.message}
        </p>
      )}
    </form>
  );
}
