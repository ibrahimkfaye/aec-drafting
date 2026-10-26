/**
 * Pure OCR (no database, no network). Input bytes are UNTRUSTED.
 * Runs a local OCR engine (tesseract.js, WebAssembly) with language data loaded
 * from disk — nothing is downloaded and nothing leaves the machine.
 *   PNG / JPEG → one page
 *   PDF        → each page rendered to an image (≤ 300 DPI, ≤ MAX_PIXELS), then OCR'd
 * Text is returned exactly as the engine produced it; confidence is the engine's
 * own 0–100 estimate, NOT a measure of accuracy.
 */
import path from "node:path";
import { JobError } from "./errors";
import { imageSize } from "./image-size";
import { MAX_PAGE_CHARS, MIN_TEXT_CHARS } from "./extract-pages";

export const MAX_OCR_PAGES = 200;
export const MAX_PIXELS = 40_000_000; // ~ A1 sheet at 150 DPI; larger pages are rendered at lower DPI
export const MAX_IMAGE_SIDE = 20_000;
export const TARGET_DPI = 300;
export const OCR_LANGUAGE = "eng";

export type OcrPage = { page: number; text: string; confidence: number };
export type OcrResult = { status: "recognized" | "no_text_found"; pages: OcrPage[]; renderDpi: number | null };

/**
 * Recorded with every OCR result. Kept as a constant (bundlers rewrite package.json
 * lookups); a unit test fails if it ever differs from the installed packages.
 */
export const OCR_ENGINE = "tesseract.js 7.0.0 (eng 4.0.0_best_int)";
export function ocrEngineName(): string {
  return OCR_ENGINE;
}

const ENGINE_START_MS = 60_000;
const PAGE_MS = 180_000;

type Recognizer = { recognize(img: Uint8Array, dpi: number | null): Promise<{ text: string; confidence: number }>; close(): Promise<void> };

function within<T>(p: Promise<T>, ms: number, code: string): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  return Promise.race([p, new Promise<never>((_, rej) => (t = setTimeout(() => rej(new JobError(code)), ms)))]).finally(() => clearTimeout(t));
}

async function openRecognizer(): Promise<Recognizer> {
  const { createWorker, OEM } = await import("tesseract.js");
  // Loaded at runtime from node_modules (an external package), so its own
  // __dirname gives the real location of the bundled language data.
  const data = (await import("@tesseract.js-data/eng")) as { langPath?: string; default?: { langPath: string } };
  const base = data.default?.langPath ?? data.langPath;
  if (!base) throw new JobError("ocr_data_missing");
  // The engine reports some failures only through errorHandler (and would otherwise
  // throw them as uncaught exceptions); turn them into a job failure instead.
  let fail!: (e: unknown) => void;
  const failed = new Promise<never>((_, rej) => (fail = rej));
  failed.catch(() => {});
  const worker = await within(
    Promise.race([
      createWorker(OCR_LANGUAGE, OEM.LSTM_ONLY, {
        langPath: path.join(path.dirname(base), "4.0.0_best_int"), // local files only — never a URL
        cacheMethod: "none", // never write language data anywhere
        gzip: true,
        errorHandler: () => fail(new JobError("ocr_engine_failed")),
      }),
      failed,
    ]),
    ENGINE_START_MS,
    "ocr_engine_unavailable",
  );
  return {
    async recognize(img, dpi) {
      if (dpi) await worker.setParameters({ user_defined_dpi: String(dpi) });
      const r = await within(Promise.race([worker.recognize(Buffer.from(img)), failed]), PAGE_MS, "ocr_page_timeout");
      return { text: r.data.text, confidence: r.data.confidence };
    },
    close: async () => void (await worker.terminate()),
  };
}

const clean = (t: string) => t.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
const clamp = (n: number) => Math.round(Math.min(100, Math.max(0, Number.isFinite(n) ? n : 0)) * 100) / 100;

function finish(pages: OcrPage[], renderDpi: number | null): OcrResult {
  for (const p of pages) if (p.text.length > MAX_PAGE_CHARS) throw new JobError("page_text_too_large");
  const visible = pages.reduce((n, p) => n + p.text.replace(/\s/g, "").length, 0);
  return visible < MIN_TEXT_CHARS ? { status: "no_text_found", pages, renderDpi } : { status: "recognized", pages, renderDpi };
}

export async function ocrPages(type: "pdf" | "png" | "jpeg", bytes: Uint8Array, recognizer?: Recognizer): Promise<OcrResult> {
  if (type === "png" || type === "jpeg") {
    const size = imageSize(type, bytes);
    if (!size || size.width === 0 || size.height === 0) throw new JobError("image_unreadable");
    if (size.width > MAX_IMAGE_SIDE || size.height > MAX_IMAGE_SIDE || size.width * size.height > MAX_PIXELS) {
      throw new JobError("image_too_large_for_ocr");
    }
    const r = recognizer ?? (await openRecognizer());
    try {
      const out = await r.recognize(bytes, null);
      return finish([{ page: 1, text: clean(out.text), confidence: clamp(out.confidence) }], null);
    } finally {
      await r.close();
    }
  }

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    disableFontFace: true,
    useSystemFonts: false,
    enableXfa: false,
    isOffscreenCanvasSupported: false,
    stopAtErrors: false,
    verbosity: 0,
  });
  let doc: Awaited<typeof task.promise>;
  try {
    doc = await task.promise;
  } catch (e) {
    await task.destroy();
    throw new JobError(e instanceof pdfjs.PasswordException ? "pdf_password_protected" : "pdf_unreadable");
  }
  let r: Recognizer | null = null;
  try {
    if (doc.numPages > MAX_OCR_PAGES) throw new JobError("too_many_pages_for_ocr");
    r = recognizer ?? (await openRecognizer());
    const factory = doc.canvasFactory as {
      create(w: number, h: number): { canvas: { toBuffer(mime: "image/png"): Buffer } };
      destroy(c: unknown): void;
    };
    const pages: OcrPage[] = [];
    let minDpi = TARGET_DPI;
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 }); // 72 units per inch
      const scale = Math.min(TARGET_DPI / 72, Math.sqrt(MAX_PIXELS / (base.width * base.height)));
      const dpi = Math.max(50, Math.floor(scale * 72));
      minDpi = Math.min(minDpi, dpi);
      const viewport = page.getViewport({ scale: dpi / 72 });
      const target = factory.create(Math.floor(viewport.width), Math.floor(viewport.height));
      await page.render({ canvas: target.canvas as unknown as HTMLCanvasElement, viewport }).promise;
      const png = target.canvas.toBuffer("image/png");
      factory.destroy(target);
      page.cleanup();
      const out = await r.recognize(png, dpi);
      pages.push({ page: n, text: clean(out.text), confidence: clamp(out.confidence) });
    }
    return finish(pages, minDpi);
  } finally {
    if (r) await r.close();
    await task.destroy();
  }
}
