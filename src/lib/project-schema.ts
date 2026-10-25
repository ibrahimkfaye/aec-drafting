import { z } from "zod";
import { DOCUMENT_TYPES } from "@/config/document-types";

const docTypeKeys = DOCUMENT_TYPES.map((d) => d.key) as [string, ...string[]];

const required = (label: string, max: number) =>
  z
    .string({ error: `${label} is required.` })
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `${label} must be ${max} characters or fewer.`);

/** Fields a user may set on a project. Everything else (firm, creator, version) is server-controlled. */
export const projectFieldsSchema = z.object({
  name: required("Project name", 200),
  client_name: required("Client", 200),
  location: required("Location", 500),
  document_type: z.enum(docTypeKeys, { error: "Choose a document type." }),
  scope_instructions: z
    .string()
    .max(20000, "Scope and instructions must be 20,000 characters or fewer.")
    .default(""),
  assigned_reviewer_id: z
    .union([z.literal(""), z.uuid({ error: "Choose a reviewer from the list." })])
    .transform((v) => (v === "" ? null : v)),
});

export type ProjectFields = z.output<typeof projectFieldsSchema>;
export type ProjectFieldName = keyof ProjectFields;

export const projectRefSchema = z.object({
  id: z.uuid(),
  row_version: z.coerce.number().int().positive(),
});

export const FIELD_NAMES: ProjectFieldName[] = [
  "name",
  "client_name",
  "location",
  "document_type",
  "scope_instructions",
  "assigned_reviewer_id",
];

/** Reads only the known project fields out of a submitted form. */
export function readProjectForm(formData: FormData): Record<ProjectFieldName, string> {
  const out = {} as Record<ProjectFieldName, string>;
  for (const f of FIELD_NAMES) {
    const v = formData.get(f);
    out[f] = typeof v === "string" ? v : "";
  }
  return out;
}

export function fieldErrors(error: z.ZodError): Partial<Record<ProjectFieldName, string>> {
  const out: Partial<Record<ProjectFieldName, string>> = {};
  for (const issue of error.issues) {
    const key = issue.path[0] as ProjectFieldName;
    if (key && !out[key]) out[key] = issue.message;
  }
  return out;
}
