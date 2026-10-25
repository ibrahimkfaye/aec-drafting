/**
 * Pure page-text extraction (no database, no network). Input bytes are UNTRUSTED.
 *   PDF  → text from the file's own text layer, page by page (pdf.js, fonts not loaded)
 *   TXT  → the whole file as page 1
 *   PNG / JPEG, or a PDF with no usable text layer → "needs_ocr": nothing is guessed
 * Text is returned exactly as found, apart from joining pdf.js text runs into lines.
 */
import { JobError } from "./errors";

export const MAX_PAGES = 2000;
export const MAX_PAGE_CHARS = 200_000;
/** Below this many non-space characters in the whole file, treat it as scanned. */
export const MIN_TEXT_CHARS = 20;

export type PageText = { page: number; text: string };
export type Extraction =
  | {
      status: "extracted";
      method: "pdf_text_layer" | "plain_text";
      pages: PageText[];
    }
  | { status: "needs_ocr"; method: "none"; pages: PageText[] };

const visibleChars = (pages: PageText[]) =>
  pages.reduce((n, p) => n + p.text.replace(/\s/g, "").length, 0);

export async function extractPages(
  type: "pdf" | "png" | "jpeg" | "text",
  bytes: Uint8Array,
): Promise<Extraction> {
  if (type === "png" || type === "jpeg")
    return { status: "needs_ocr", method: "none", pages: [] };

  if (type === "text") {
    const text = new TextDecoder("utf-8", { fatal: true })
      .decode(bytes)
      .replace(/^\uFEFF/, ""); // drop a byte-order mark
    if (text.length > MAX_PAGE_CHARS) throw new JobError("text_too_large");
    return {
      status: "extracted",
      method: "plain_text",
      pages: [{ page: 1, text }],
    };
  }

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data: bytes.slice(), // pdf.js takes ownership of the buffer it is given
    disableFontFace: true, // never load embedded fonts; text only
    useSystemFonts: false,
    enableXfa: false, // no interactive form rendering
    isOffscreenCanvasSupported: false,
    stopAtErrors: false,
    verbosity: 0,
  });
  let doc: Awaited<typeof task.promise>;
  try {
    doc = await task.promise;
  } catch (e) {
    await task.destroy();
    if (e instanceof pdfjs.PasswordException)
      throw new JobError("pdf_password_protected");
    if (e instanceof pdfjs.InvalidPDFException)
      throw new JobError("pdf_unreadable");
    throw new JobError("pdf_unreadable");
  }
  try {
    if (doc.numPages > MAX_PAGES) throw new JobError("too_many_pages");
    const pages: PageText[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      let text = "";
      for (const item of content.items) {
        if (!("str" in item)) continue;
        text += item.str + (item.hasEOL ? "\n" : "");
      }
      text = text.replace(/[ \t]+\n/g, "\n").trimEnd();
      if (text.length > MAX_PAGE_CHARS)
        throw new JobError("page_text_too_large");
      pages.push({ page: n, text });
      page.cleanup();
    }
    if (visibleChars(pages) < MIN_TEXT_CHARS)
      return { status: "needs_ocr", method: "none", pages: [] };
    return { status: "extracted", method: "pdf_text_layer", pages };
  } finally {
    await task.destroy();
  }
}

export const EXTRACTOR_NAME = "pdfjs-dist";
