import { describe, expect, it } from "vitest";
import { matchExcerpt } from "@/lib/excerpt";

const page = "SYNTHETIC field report\nThe overall span is 24 m between\nbearings. Founda-\ntion type: “spread footing”.";

describe("excerpt matching", () => {
  it("finds an excerpt despite line breaks, spacing, quotes and hyphenation", () => {
    expect(matchExcerpt("overall span is 24 m between bearings", [page])).toBe("found");
    expect(matchExcerpt('Foundation type: "spread footing"', [page])).toBe("found");
    expect(matchExcerpt("THE OVERALL   SPAN", [page])).toBe("found");
  });

  it("does not match a changed number, unit or word", () => {
    expect(matchExcerpt("overall span is 42 m", [page])).toBe("not_found");
    expect(matchExcerpt("overall span is 24 ft", [page])).toBe("not_found");
    expect(matchExcerpt("pad footing", [page])).toBe("not_found");
  });

  it("searches every page when no page was cited", () => {
    expect(matchExcerpt("spread footing", ["unrelated page", page])).toBe("found");
  });

  it("reports no_text when there is nothing to compare against", () => {
    expect(matchExcerpt("anything", null)).toBe("no_text");
    expect(matchExcerpt("anything", ["", "  "])).toBe("no_text");
  });
});
