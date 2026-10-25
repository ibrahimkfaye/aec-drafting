"use client";

import { useActionState, useEffect, useRef } from "react";
import { saveFact, type FactFormState } from "./actions";
import { PageTextPicker } from "./page-text-picker";
import type { FactFormField } from "@/lib/fact-schema";

type Props = {
  projectId: string;
  versions: { id: string; label: string }[];
  /** Present when editing an existing fact. */
  edit?: { factId: string; basedOn: string; initial: Record<FactFormField, string> };
  submitLabel: string;
};

const input = "w-full rounded border border-zinc-300 px-3 py-2 text-sm";
const EMPTY: Record<FactFormField, string> = { statement: "", source_version_id: "", page: "", section: "", excerpt: "" };

export function FactForm({ projectId, versions, edit, submitLabel }: Props) {
  const [state, action, pending] = useActionState<FactFormState, FormData>(saveFact, { status: "idle" });
  const formRef = useRef<HTMLFormElement>(null);
  const values = state.status === "error" && state.values ? state.values : (edit?.initial ?? EMPTY);
  const err = state.fieldErrors ?? {};
  const id = (f: string) => `${edit ? `edit-${edit.factId}` : "new"}-${f}`;

  useEffect(() => {
    if (state.status === "saved" && !edit) formRef.current?.reset();
  }, [state, edit]);

  if (versions.length === 0) {
    return <p className="text-sm text-zinc-600">Upload and store at least one source file before adding facts.</p>;
  }

  const fieldError = (f: FactFormField) => err[f] && <p className="text-sm text-red-700">{err[f]}</p>;

  const field = (name: string) => formRef.current?.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | null;

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="project_id" value={projectId} />
      {edit && (
        <>
          <input type="hidden" name="fact_id" value={edit.factId} />
          <input type="hidden" name="based_on" value={edit.basedOn} />
        </>
      )}
      {state.message && (
        <p role="alert" data-testid="fact-form-error" className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-800">
          {state.message}
        </p>
      )}
      {state.status === "saved" && (
        <p role="status" className="text-sm text-emerald-800">
          Saved as a candidate fact. It needs review before it counts as evidence.
        </p>
      )}
      <div className="flex flex-col gap-1">
        <label htmlFor={id("statement")} className="text-sm font-medium">
          Fact (one clear statement)
        </label>
        <textarea id={id("statement")} name="statement" rows={2} defaultValue={values.statement} className={input} />
        {fieldError("statement")}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr_1fr]">
        <div className="flex flex-col gap-1">
          <label htmlFor={id("source_version_id")} className="text-sm font-medium">
            Source file
          </label>
          <select id={id("source_version_id")} name="source_version_id" defaultValue={values.source_version_id} className={input}>
            <option value="">Choose…</option>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
          {fieldError("source_version_id")}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={id("page")} className="text-sm font-medium">
            Page
          </label>
          <input id={id("page")} name="page" inputMode="numeric" defaultValue={values.page} className={input} />
          {fieldError("page")}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={id("section")} className="text-sm font-medium">
            Section
          </label>
          <input id={id("section")} name="section" defaultValue={values.section} className={input} />
          {fieldError("section")}
        </div>
      </div>
      <PageTextPicker
        projectId={projectId}
        getSource={() => field("source_version_id")?.value ?? ""}
        getPage={() => field("page")?.value ?? ""}
        setExcerpt={(t) => {
          const el = field("excerpt");
          if (el) el.value = t;
        }}
      />
      <div className="flex flex-col gap-1">
        <label htmlFor={id("excerpt")} className="text-sm font-medium">
          Supporting excerpt (copied from the source)
        </label>
        <textarea id={id("excerpt")} name="excerpt" rows={3} defaultValue={values.excerpt} className={input} />
        {fieldError("excerpt")}
      </div>
      <div>
        <button type="submit" disabled={pending} className="rounded bg-zinc-900 px-4 py-1.5 text-sm text-white disabled:opacity-50">
          {pending ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
