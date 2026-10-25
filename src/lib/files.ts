/**
 * File acceptance rules (pure functions; used by server actions and tests).
 * Uploaded files are DATA. Nothing here executes, renders, or interprets them.
 */

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // keep in sync with migration 0003 + bucket limit

export type DetectedType = "pdf" | "png" | "jpeg" | "text";
export type BlockReason =
  | "unsupported_type"
  | "too_large"
  | "empty_file"
  | "signature_mismatch"
  | "invalid_text"
  | "size_mismatch"
  | "missing_upload";

const BY_EXTENSION: Record<string, { type: DetectedType; mime: string }> = {
  ".pdf": { type: "pdf", mime: "application/pdf" },
  ".png": { type: "png", mime: "image/png" },
  ".jpg": { type: "jpeg", mime: "image/jpeg" },
  ".jpeg": { type: "jpeg", mime: "image/jpeg" },
  ".txt": { type: "text", mime: "text/plain" },
};

export const SUPPORTED_SUMMARY = "PDF, PNG, JPG and plain-text (.txt) files up to 25 MB";

const HINTS: [RegExp, string][] = [
  [/^\.(docx?|rtf|odt|pages)$/, "Word-processor files aren't supported yet. Export to PDF and upload that."],
  [/^\.(xlsx?|xlsm|csv|ods|numbers)$/, "Spreadsheets aren't supported in the pilot yet. Export to PDF if needed."],
  [/^\.(dwg|dxf|dgn|rvt|rfa|ifc|nwd|skp|shp|kml|kmz|gdb|las|laz)$/, "CAD, BIM and GIS files aren't supported. Export the drawing or map to PDF or PNG."],
  [/^\.(heic|heif|tiff?|gif|webp|bmp)$/, "This image format isn't supported. Convert to PNG or JPG."],
];

export const BLOCK_REASON_TEXT: Record<BlockReason, string> = {
  unsupported_type: "Unsupported file type",
  too_large: "Larger than 25 MB",
  empty_file: "Empty file",
  signature_mismatch: "File contents don't match its extension",
  invalid_text: "Not a valid plain-text file",
  size_mismatch: "Uploaded size didn't match",
  missing_upload: "Upload didn't arrive",
};

export function extensionOf(filename: string): string {
  const m = filename.toLowerCase().match(/(\.[a-z0-9]{1,10})$/);
  return m ? m[1] : "";
}

/** Keeps a display-safe original filename: no path, no control characters, ≤255 chars. */
export function sanitizeFilename(raw: string): string {
  const base = raw.normalize("NFC").split(/[/\\]/).pop() ?? "";
  let name = base.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim();
  if (!name) name = "unnamed";
  if (name.length > 255) {
    const ext = extensionOf(name);
    name = name.slice(0, 255 - ext.length) + ext;
  }
  return name;
}

export type Preflight =
  | { ok: true; expectedType: DetectedType; mime: string }
  | { ok: false; reason: BlockReason; message: string };

/** Checks name and size BEFORE any bytes are uploaded. */
export function preflight(filename: string, size: number): Preflight {
  const ext = extensionOf(filename);
  const known = BY_EXTENSION[ext];
  if (!known) {
    const hint = HINTS.find(([re]) => re.test(ext))?.[1];
    return {
      ok: false,
      reason: "unsupported_type",
      message: `${ext ? `"${ext}" files` : "Files without an extension"} can't be used. ${hint ?? `Supported: ${SUPPORTED_SUMMARY}.`}`,
    };
  }
  if (size <= 0) return { ok: false, reason: "empty_file", message: "This file is empty." };
  if (size > MAX_UPLOAD_BYTES) {
    return { ok: false, reason: "too_large", message: "This file is larger than 25 MB. Split or compress it." };
  }
  return { ok: true, expectedType: known.type, mime: known.mime };
}

const startsWith = (b: Uint8Array, sig: number[], offset = 0) => sig.every((v, i) => b[offset + i] === v);

/** Identifies a binary format from its first bytes ("magic numbers"). */
export function detectBinaryType(bytes: Uint8Array): "pdf" | "png" | "jpeg" | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  // PDF readers accept the "%PDF-" header anywhere in the first 1024 bytes.
  const head = bytes.subarray(0, 1024);
  for (let i = 0; i + 5 <= head.length; i++) {
    if (startsWith(head, [0x25, 0x50, 0x44, 0x46, 0x2d], i)) return "pdf";
  }
  return null;
}

/** Plain text must be valid UTF-8 without NUL bytes (binary files almost always contain NULs). */
export function isPlainText(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

export type ContentCheck = { ok: true; detectedType: DetectedType } | { ok: false; reason: BlockReason };

/** Checks the actual stored bytes against what the filename claims. */
export function checkContent(expected: DetectedType, bytes: Uint8Array): ContentCheck {
  if (bytes.length === 0) return { ok: false, reason: "empty_file" };
  const binary = detectBinaryType(bytes);
  if (expected === "text") {
    if (binary) return { ok: false, reason: "signature_mismatch" };
    return isPlainText(bytes) ? { ok: true, detectedType: "text" } : { ok: false, reason: "invalid_text" };
  }
  return binary === expected ? { ok: true, detectedType: expected } : { ok: false, reason: "signature_mismatch" };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
