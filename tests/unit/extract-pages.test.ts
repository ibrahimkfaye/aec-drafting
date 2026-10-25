/** Page-text extraction from SYNTHETIC in-memory files. */
import { describe, expect, it } from "vitest";
import { MAX_PAGE_CHARS, extractPages } from "@/lib/jobs/extract-pages";
import { JobError } from "@/lib/jobs/errors";
import { makePdf } from "./fixtures/make-pdf";

describe("PDF text layer", () => {
  it("returns each page's text, keeping empty pages as empty", async () => {
    const r = await extractPages("pdf", makePdf(["SYNTHETIC page one\nspan 24 m", "", "SYNTHETIC page three"]));
    expect(r.status).toBe("extracted");
    expect(r.method).toBe("pdf_text_layer");
    expect(r.pages.map((p) => p.page)).toEqual([1, 2, 3]);
    expect(r.pages[0].text).toBe("SYNTHETIC page one\nspan 24 m");
    expect(r.pages[1].text).toBe("");
    expect(r.pages[2].text).toBe("SYNTHETIC page three");
  });

  it("flags a PDF with no text layer as needing OCR instead of guessing", async () => {
    const r = await extractPages("pdf", makePdf(["", "", ""]));
    expect(r).toEqual({ status: "needs_ocr", method: "none", pages: [] });
  });

  it("refuses unreadable PDF bytes with a code, not a crash", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.4\nnot really a pdf\n%%EOF\n");
    await expect(extractPages("pdf", bytes)).rejects.toBeInstanceOf(JobError);
  });
});

describe("other types", () => {
  it("treats a text file as a single page, exactly as written", async () => {
    const r = await extractPages("text", new TextEncoder().encode("﻿SYNTHETIC note\nline two"));
    expect(r).toEqual({ status: "extracted", method: "plain_text", pages: [{ page: 1, text: "SYNTHETIC note\nline two" }] });
  });

  it("refuses an oversized text file instead of cutting it", async () => {
    const big = new TextEncoder().encode("x".repeat(MAX_PAGE_CHARS + 1));
    await expect(extractPages("text", big)).rejects.toMatchObject({ code: "text_too_large" });
  });

  it.each(["png", "jpeg"] as const)("%s images need OCR", async (t) => {
    expect(await extractPages(t, new Uint8Array([1, 2, 3]))).toEqual({ status: "needs_ocr", method: "none", pages: [] });
  });
});
