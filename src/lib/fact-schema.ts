import { z } from "zod";

/** One citation as entered in the evidence form. */
export const citationSchema = z
  .object({
    source_version_id: z.uuid({ error: "Choose the source file this comes from." }),
    page: z
      .string()
      .trim()
      .transform((v) => (v === "" ? null : Number(v)))
      .pipe(z.number({ error: "Page must be a whole number." }).int("Page must be a whole number.").min(1, "Page must be 1 or more.").max(100000).nullable()),
    section: z.string().trim().max(200, "Section must be 200 characters or fewer."),
    excerpt: z
      .string()
      .trim()
      .min(1, "Paste the supporting excerpt from the source.")
      .max(2000, "Excerpt must be 2,000 characters or fewer."),
  })
  .refine((c) => c.page !== null || c.section !== "", { message: "Give a page number or a section.", path: ["page"] });

export const factFormSchema = z.object({
  statement: z
    .string()
    .trim()
    .min(1, "Write the fact as one clear statement.")
    .max(2000, "Statement must be 2,000 characters or fewer."),
  citation: citationSchema,
});

export type FactFormField = "statement" | "source_version_id" | "page" | "section" | "excerpt";
export const FACT_FIELDS: FactFormField[] = ["statement", "source_version_id", "page", "section", "excerpt"];

export function readFactForm(formData: FormData): Record<FactFormField, string> {
  const out = {} as Record<FactFormField, string>;
  for (const f of FACT_FIELDS) {
    const v = formData.get(f);
    out[f] = typeof v === "string" ? v : "";
  }
  return out;
}

export function parseFactForm(raw: Record<FactFormField, string>) {
  return factFormSchema.safeParse({
    statement: raw.statement,
    citation: { source_version_id: raw.source_version_id, page: raw.page, section: raw.section, excerpt: raw.excerpt },
  });
}

export function factFieldErrors(error: z.ZodError): Partial<Record<FactFormField, string>> {
  const out: Partial<Record<FactFormField, string>> = {};
  for (const issue of error.issues) {
    const key = (issue.path[issue.path.length - 1] ?? "statement") as FactFormField;
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/** Maps database refusals to plain-language messages (never shows raw errors). */
export function friendlyFactError(message: string | undefined): string {
  const m = message ?? "";
  if (m.includes("separation of duties")) return "You wrote this revision, so another reviewer must review it.";
  if (m.includes("stale")) return "This fact changed after you opened it. Nothing was saved. Reload the page to see the latest version.";
  if (m.includes("without a cited source")) return "A fact needs at least one cited source before it can be approved.";
  if (m.includes("needs a note")) return "Explain why you are rejecting this fact.";
  if (m.includes("archived")) return "This project is archived.";
  if (m.includes("only stored files")) return "Only stored files can be cited.";
  if (m.includes("not allowed") || m.includes("not found")) return "You don't have permission to do that.";
  return "That could not be saved. Please try again.";
}
