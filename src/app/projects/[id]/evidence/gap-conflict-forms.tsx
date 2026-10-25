"use client";

import { useActionState, useEffect, useRef } from "react";
import { closeGap, raiseConflict, raiseGap, resolveConflict, type SimpleState } from "./gap-conflict-actions";

const idle: SimpleState = { status: "idle" };
const input = "w-full rounded border border-zinc-300 px-2 py-1.5 text-sm";
const btn = "rounded bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-50";

function Message({ state, testId }: { state: SimpleState; testId: string }) {
  if (!state.message) return null;
  return (
    <p role="alert" data-testid={testId} className="text-sm text-red-700">
      {state.message}
    </p>
  );
}

function useResetOnDone(state: SimpleState) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.status === "done") ref.current?.reset();
  }, [state]);
  return ref;
}

export function RaiseGapForm({ projectId }: { projectId: string }) {
  const [state, action, pending] = useActionState(raiseGap, idle);
  const ref = useResetOnDone(state);
  return (
    <form ref={ref} action={action} className="flex flex-col gap-2">
      <input type="hidden" name="project_id" value={projectId} />
      <label htmlFor="gap-description" className="text-sm font-medium">
        What information is missing?
      </label>
      <textarea id="gap-description" name="description" rows={2} className={input} defaultValue={state.values?.description} />
      <Message state={state} testId="gap-form-error" />
      <div>
        <button type="submit" disabled={pending} className={btn}>
          Raise gap
        </button>
      </div>
    </form>
  );
}

export function CloseGapForm({
  projectId,
  gapId,
  approvedFacts,
}: {
  projectId: string;
  gapId: string;
  approvedFacts: { revisionId: string; statement: string }[];
}) {
  const [state, action, pending] = useActionState(closeGap, idle);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="gap_id" value={gapId} />
      <label htmlFor={`gap-fact-${gapId}`} className="text-xs text-zinc-600">
        Approved fact that fills this gap
      </label>
      <select id={`gap-fact-${gapId}`} name="fact_revision_id" className={input} defaultValue={state.values?.choice ?? ""} key={state.values?.choice ?? ""}>
        <option value="">Choose…</option>
        {approvedFacts.map((f) => (
          <option key={f.revisionId} value={f.revisionId}>
            {f.statement}
          </option>
        ))}
      </select>
      <label htmlFor={`gap-note-${gapId}`} className="text-xs text-zinc-600">
        Note (required to dismiss)
      </label>
      <textarea id={`gap-note-${gapId}`} name="note" rows={2} className={input} defaultValue={state.values?.note} />
      <div className="flex gap-2">
        <button type="submit" name="decision" value="resolve" disabled={pending} className={btn}>
          Resolve with fact
        </button>
        <button type="submit" name="decision" value="dismiss" disabled={pending} className="rounded border border-zinc-300 px-3 py-1.5 text-sm">
          Dismiss
        </button>
      </div>
      <Message state={state} testId="gap-close-error" />
    </form>
  );
}

export function RaiseConflictForm({ projectId, facts }: { projectId: string; facts: { factId: string; statement: string }[] }) {
  const [state, action, pending] = useActionState(raiseConflict, idle);
  const ref = useResetOnDone(state);
  if (facts.length < 2) return <p className="text-sm text-zinc-500">Add at least two facts to record a conflict between them.</p>;
  return (
    <form ref={ref} action={action} className="flex flex-col gap-2">
      <input type="hidden" name="project_id" value={projectId} />
      <label htmlFor="conflict-description" className="text-sm font-medium">
        What disagrees?
      </label>
      <textarea id="conflict-description" name="description" rows={2} className={input} defaultValue={state.values?.description} />
      <fieldset className="flex flex-col gap-1">
        <legend className="text-sm font-medium">Conflicting facts (choose two or more)</legend>
        {facts.map((f) => (
          <label key={f.factId} className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="fact_ids" value={f.factId} className="mt-1" defaultChecked={state.values?.fact_ids?.includes(f.factId)} />
            <span>{f.statement}</span>
          </label>
        ))}
      </fieldset>
      <Message state={state} testId="conflict-form-error" />
      <div>
        <button type="submit" disabled={pending} className={btn}>
          Raise conflict
        </button>
      </div>
    </form>
  );
}

export function ResolveConflictForm({
  projectId,
  conflictId,
  facts,
}: {
  projectId: string;
  conflictId: string;
  facts: { factId: string; statement: string }[];
}) {
  const [state, action, pending] = useActionState(resolveConflict, idle);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="conflict_id" value={conflictId} />
      <fieldset className="flex flex-col gap-1">
        <legend className="text-xs text-zinc-600">Which fact stands? The others will be left out of evidence snapshots.</legend>
        {facts.map((f) => (
          <label key={f.factId} className="flex items-start gap-2 text-sm">
            <input type="radio" name="prevailing_fact_id" value={f.factId} className="mt-1" defaultChecked={state.values?.choice === f.factId} />
            <span>{f.statement}</span>
          </label>
        ))}
      </fieldset>
      <label htmlFor={`conflict-note-${conflictId}`} className="text-xs text-zinc-600">
        Resolution note (required)
      </label>
      <textarea id={`conflict-note-${conflictId}`} name="note" rows={2} className={input} defaultValue={state.values?.note} />
      <div>
        <button type="submit" disabled={pending} className={btn}>
          Resolve conflict
        </button>
      </div>
      <Message state={state} testId="conflict-resolve-error" />
    </form>
  );
}
