/**
 * Does a cited excerpt actually appear in the extracted text?
 * Comparison ignores differences that extraction itself introduces — line breaks,
 * repeated spaces, curly vs straight quotes, dash variants, hyphenated line ends —
 * but NOT wording, numbers or units: "24 m" never matches "42 m".
 */
export type ExcerptMatch = "found" | "not_found" | "no_text";

export function normalizeForMatch(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/(\w)-\s*\n\s*(\w)/g, "$1$2") // word split across a line end: "founda-\ntion"
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** `pages` = extracted text of the cited page, or of every page when no page was cited. */
export function matchExcerpt(excerpt: string, pages: string[] | null): ExcerptMatch {
  if (!pages || pages.every((p) => p.trim() === "")) return "no_text";
  const needle = normalizeForMatch(excerpt);
  if (!needle) return "not_found";
  return pages.some((p) => normalizeForMatch(p).includes(needle)) ? "found" : "not_found";
}
