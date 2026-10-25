"use client";

import { useActionState } from "react";
import type { ProjectFormState } from "./actions";
import type { ProjectFieldName } from "@/lib/project-schema";

type Option = { value: string; label: string };

type Props = {
  action: (prev: ProjectFormState, formData: FormData) => Promise<ProjectFormState>;
  submitLabel: string;
  documentTypes: Option[];
  reviewers: Option[];
  initial: Record<ProjectFieldName, string>;
  /** Present when editing: identifies the exact version the user is editing. */
  versionRef?: { id: string; row_version: number };
};

const input = "w-full rounded border border-zinc-300 px-3 py-2";

export function ProjectForm({ action, submitLabel, documentTypes, reviewers, initial, versionRef }: Props) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" });
  const values = state.values ?? initial;
  const err = state.fieldErrors ?? {};

  const field = (name: ProjectFieldName, label: string, el: React.ReactNode, hint?: string) => (
    <div className="flex flex-col gap-1">
      <label htmlFor={name} className="text-sm font-medium">
        {label}
      </label>
      {el}
      {hint && <p className="text-xs text-zinc-500">{hint}</p>}
      {err[name] && (
        <p id={`${name}-error`} className="text-sm text-red-700">
          {err[name]}
        </p>
      )}
    </div>
  );

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {versionRef && (
        <>
          <input type="hidden" name="id" value={versionRef.id} />
          <input type="hidden" name="row_version" value={versionRef.row_version} />
        </>
      )}
      {state.message && (
        <p
          role="alert"
          data-testid={state.status === "conflict" ? "conflict-message" : "form-error"}
          className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {state.message}
        </p>
      )}
      {field("name", "Project name", <input id="name" name="name" defaultValue={values.name} className={input} maxLength={200} />)}
      {field("client_name", "Client", <input id="client_name" name="client_name" defaultValue={values.client_name} className={input} maxLength={200} />)}
      {field("location", "Location", <input id="location" name="location" defaultValue={values.location} className={input} maxLength={500} />)}
      {field(
        "document_type",
        "Document type",
        <select id="document_type" name="document_type" defaultValue={values.document_type} className={input}>
          <option value="">Choose…</option>
          {documentTypes.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>,
      )}
      {field(
        "scope_instructions",
        "Scope and instructions",
        <textarea id="scope_instructions" name="scope_instructions" defaultValue={values.scope_instructions} rows={6} className={input} maxLength={20000} />,
        "What the document must cover. This is guidance for drafting, not evidence.",
      )}
      {field(
        "assigned_reviewer_id",
        "Assigned reviewer",
        <select id="assigned_reviewer_id" name="assigned_reviewer_id" defaultValue={values.assigned_reviewer_id} className={input}>
          <option value="">Not assigned yet</option>
          {reviewers.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>,
        "Only firm reviewers and admins can be assigned.",
      )}
      <div>
        <button type="submit" disabled={pending} className="rounded bg-zinc-900 px-4 py-2 text-white disabled:opacity-50">
          {pending ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
