/**
 * Local OCR on SYNTHETIC scans drawn in memory (no real documents, no network:
 * language data is read from node_modules). Uses the real OCR engine, so it is slower.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { imageSize } from "../../src/lib/jobs/image-size";
import { MAX_PIXELS, ocrEngineName, ocrPages } from "../../src/lib/jobs/ocr-pages";
import { makePdf } from "./fixtures/make-pdf";
import { makeScanImage, makeScanPdf } from "./fixtures/make-scan";

const LINES = ["SYNTHETIC inspection report", "The overall span is 24 m between bearings."];

/** Stands in for the engine: records what it was given, never reads the image. */
function fakeRecognizer() {
  const seen: { bytes: number; dpi: number | null }[] = [];
  return {
    seen,
    recognize: async (img: Uint8Array, dpi: number | null) => (seen.push({ bytes: img.length, dpi }), { text: "", confidence: 0 }),
    close: async () => {},
  };
}

describe("imageSize (header only, no decoding)", () => {
  it("reads PNG and JPEG dimensions", () => {
    expect(imageSize("png", makeScanImage(["x"], "png", 640, 480))).toEqual({ width: 640, height: 480 });
    expect(imageSize("jpeg", makeScanImage(["x"], "jpeg", 800, 600))).toEqual({ width: 800, height: 600 });
  });

  it("returns null for damaged headers", () => {
    expect(imageSize("png", new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(imageSize("jpeg", new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
    expect(imageSize("jpeg", new Uint8Array([0xff, 0xd8, 0x00, 0x00, 0x00]))).toBeNull();
  });
});

describe("ocrPages", () => {
  it("refuses an image whose header claims a huge size, before any decoding", async () => {
    const png = makeScanImage(["x"], "png", 10, 10);
    const view = new DataView(png.buffer, png.byteOffset);
    view.setUint32(16, 100_000);
    view.setUint32(20, 100_000);
    const r = fakeRecognizer();
    await expect(ocrPages("png", png, r)).rejects.toMatchObject({ code: "image_too_large_for_ocr" });
    expect(r.seen).toEqual([]);
  });

  it("refuses PDFs with too many pages for OCR", async () => {
    const r = fakeRecognizer();
    await expect(ocrPages("pdf", makePdf(Array(201).fill("")), r)).rejects.toMatchObject({ code: "too_many_pages_for_ocr" });
    expect(r.seen).toEqual([]);
  });

  it("renders large sheets at a lower DPI so no page exceeds the pixel limit", async () => {
    const r = fakeRecognizer();
    // A0 landscape (1189 x 841 mm) in PDF points
    const out = await ocrPages("pdf", makeScanPdf([null], 1700, 1100, [3370, 2384]), r);
    const dpi = r.seen[0].dpi!;
    expect(dpi).toBeLessThan(300);
    expect((3370 / 72) * dpi * ((2384 / 72) * dpi)).toBeLessThanOrEqual(MAX_PIXELS);
    expect(out).toMatchObject({ status: "no_text_found", renderDpi: dpi });
  });

  it("names the engine and language data it used, matching the installed packages", () => {
    const v = createRequire(import.meta.url)("tesseract.js/package.json").version;
    expect(ocrEngineName()).toBe(`tesseract.js ${v} (eng 4.0.0_best_int)`);
    expect(existsSync(path.join(path.dirname(createRequire(import.meta.url).resolve("@tesseract.js-data/eng")), "4.0.0_best_int", "eng.traineddata.gz"))).toBe(true);
  });

  it("recognizes text in a scanned image", { timeout: 60_000 }, async () => {
    const out = await ocrPages("png", makeScanImage(LINES));
    expect(out.status).toBe("recognized");
    expect(out.renderDpi).toBeNull();
    expect(out.pages).toHaveLength(1);
    expect(out.pages[0].text).toContain("The overall span is 24 m between bearings.");
    expect(out.pages[0].confidence).toBeGreaterThan(50);
    expect(out.pages[0].confidence).toBeLessThanOrEqual(100);
  });

  it("recognizes a scanned PDF page by page; blank pages stay blank", { timeout: 60_000 }, async () => {
    const out = await ocrPages("pdf", makeScanPdf([makeScanImage(LINES, "jpeg"), null]));
    expect(out.status).toBe("recognized");
    expect(out.renderDpi).toBe(300);
    expect(out.pages.map((p) => p.page)).toEqual([1, 2]);
    expect(out.pages[0].text).toContain("span is 24 m");
    expect(out.pages[1].text).toBe("");
  });

  it("reports 'no text found' for a blank scan instead of inventing text", { timeout: 60_000 }, async () => {
    const out = await ocrPages("pdf", makeScanPdf([null]));
    expect(out.status).toBe("no_text_found");
  });
});
