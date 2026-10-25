import { describe, expect, it } from "vitest";
import { factFieldErrors, friendlyFactError, parseFactForm } from "@/lib/fact-schema";

const base = {
  statement: "SYNTHETIC: Bridge span is 24 m.",
  source_version_id: crypto.randomUUID(),
  page: "3",
  section: "",
  excerpt: "SYNTHETIC excerpt: overall span 24 m",
};

describe("fact form", () => {
  it("accepts a statement with a cited page and excerpt", () => {
    const r = parseFactForm(base);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.citation.page).toBe(3);
  });

  it("accepts a section instead of a page", () => {
    expect(parseFactForm({ ...base, page: "", section: "3.2 Loads" }).success).toBe(true);
  });

  it.each([
    [{ statement: "  " }, "statement", "Write the fact"],
    [{ source_version_id: "" }, "source_version_id", "Choose the source file"],
    [{ excerpt: "" }, "excerpt", "Paste the supporting excerpt"],
    [{ page: "", section: "" }, "page", "Give a page number or a section"],
    [{ page: "abc" }, "page", "whole number"],
    [{ page: "0" }, "page", "1 or more"],
    [{ page: "2.5" }, "page", "whole number"],
  ])("rejects %o", (override, field, message) => {
    const r = parseFactForm({ ...base, ...override });
    expect(r.success).toBe(false);
    if (!r.success) expect(factFieldErrors(r.error)[field as keyof ReturnType<typeof factFieldErrors>]).toContain(message);
  });
});

describe("database refusals become plain language", () => {
  it.each([
    ["separation of duties: you cannot review…", "another reviewer"],
    ["stale: this fact changed after you opened it", "Nothing was saved"],
    ["a fact without a cited source cannot be approved", "at least one cited source"],
    ["a rejection needs a note explaining why", "Explain why"],
    ["project not found or not allowed", "permission"],
    ["separation of duties: you cannot close an item you raised", "You raised this item"],
    ["dismissing a gap needs a note explaining why", "dismissing this gap"],
    ["resolving a conflict needs a note explaining why", "how the conflict was resolved"],
    ["only a current, approved fact can resolve a gap", "current, approved fact"],
    ["a conflict needs at least two different facts", "at least two"],
    ["something unexpected", "Please try again"],
  ])("%s", (dbMessage, expected) => {
    expect(friendlyFactError(dbMessage)).toContain(expected);
  });
});
