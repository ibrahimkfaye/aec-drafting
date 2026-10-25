/** File acceptance rules. All byte fixtures are SYNTHETIC and built in memory. */
import { describe, expect, it } from "vitest";
import {
  MAX_UPLOAD_BYTES,
  checkContent,
  detectBinaryType,
  extensionOf,
  isPlainText,
  preflight,
  sanitizeFilename,
} from "@/lib/files";

const bytes = (...xs: number[]) => new Uint8Array(xs);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 16);
const PDF = new TextEncoder().encode("%PDF-1.7\n%SYNTHETIC\n");
const EXE = bytes(0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00); // "MZ" Windows executable header
const ZIP = bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00); // DOCX/XLSX are ZIP containers

describe("preflight (name and size, before upload)", () => {
  it.each([
    ["report.pdf", "pdf"],
    ["MAP.PNG", "png"],
    ["photo.jpg", "jpeg"],
    ["photo.jpeg", "jpeg"],
    ["field-notes.txt", "text"],
  ])("accepts %s", (name, type) => {
    expect(preflight(name, 100)).toMatchObject({ ok: true, expectedType: type });
  });

  it.each([
    ["spec.docx", /Export to PDF/],
    ["budget.xlsx", /Spreadsheets/],
    ["site.dwg", /CAD, BIM and GIS/],
    ["model.rvt", /CAD, BIM and GIS/],
    ["parcels.shp", /CAD, BIM and GIS/],
    ["setup.exe", /Supported: PDF, PNG, JPG/],
    ["noextension", /without an extension/],
    ["report.pdf.exe", /Supported/],
  ])("blocks %s with a helpful message", (name, msg) => {
    const r = preflight(name, 100);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("unsupported_type");
      expect(r.message).toMatch(msg);
    }
  });

  it("blocks empty and oversized files", () => {
    expect(preflight("a.pdf", 0)).toMatchObject({ ok: false, reason: "empty_file" });
    expect(preflight("a.pdf", MAX_UPLOAD_BYTES + 1)).toMatchObject({ ok: false, reason: "too_large" });
    expect(preflight("a.pdf", MAX_UPLOAD_BYTES)).toMatchObject({ ok: true });
  });
});

describe("content checks (actual bytes, after upload)", () => {
  it("recognizes real signatures", () => {
    expect(detectBinaryType(PNG)).toBe("png");
    expect(detectBinaryType(JPEG)).toBe("jpeg");
    expect(detectBinaryType(PDF)).toBe("pdf");
    expect(detectBinaryType(EXE)).toBeNull();
  });

  it("accepts a PDF header preceded by a little junk (as PDF readers do), but not after 1 KB", () => {
    const junk = new Uint8Array(500).fill(0x20);
    expect(detectBinaryType(new Uint8Array([...junk, ...PDF]))).toBe("pdf");
    const far = new Uint8Array(1100).fill(0x20);
    expect(detectBinaryType(new Uint8Array([...far, ...PDF]))).toBeNull();
  });

  it.each([
    ["pdf", EXE, "an executable renamed to .pdf"],
    ["pdf", ZIP, "a Word file renamed to .pdf"],
    ["png", JPEG, "a JPEG renamed to .png"],
    ["jpeg", PDF, "a PDF renamed to .jpg"],
    ["text", PDF, "a PDF renamed to .txt"],
  ] as const)("blocks bytes claiming %s: %s", (expected, data, _description) => {
    void _description;
    expect(checkContent(expected, data)).toEqual({ ok: false, reason: "signature_mismatch" });
  });

  it("accepts matching content", () => {
    expect(checkContent("pdf", PDF)).toEqual({ ok: true, detectedType: "pdf" });
    expect(checkContent("png", PNG)).toEqual({ ok: true, detectedType: "png" });
    expect(checkContent("text", new TextEncoder().encode("SYNTHETIC field note: pier 3, ±2 mm, 20 °C"))).toEqual({
      ok: true,
      detectedType: "text",
    });
  });

  it("rejects binary or non-UTF-8 'text'", () => {
    expect(isPlainText(EXE)).toBe(false);
    expect(isPlainText(bytes(0xc3, 0x28))).toBe(false); // invalid UTF-8 sequence
    expect(checkContent("text", EXE)).toEqual({ ok: false, reason: "invalid_text" });
  });

  it("treats empty content as empty, whatever the extension", () => {
    expect(checkContent("pdf", new Uint8Array())).toEqual({ ok: false, reason: "empty_file" });
  });
});

describe("filenames", () => {
  it("strips paths and control characters and keeps the extension when shortening", () => {
    expect(sanitizeFilename("C:\\Users\\x\\notes.txt")).toBe("notes.txt");
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("a\u0000b\nc.pdf")).toBe("abc.pdf");
    expect(sanitizeFilename("   ")).toBe("unnamed");
    const long = sanitizeFilename(`${"x".repeat(300)}.pdf`);
    expect(long.length).toBe(255);
    expect(long.endsWith(".pdf")).toBe(true);
  });
  it("finds extensions case-insensitively", () => {
    expect(extensionOf("A.PDF")).toBe(".pdf");
    expect(extensionOf("archive.tar.gz")).toBe(".gz");
    expect(extensionOf("README")).toBe("");
  });
});
