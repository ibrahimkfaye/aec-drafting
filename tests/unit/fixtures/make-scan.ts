/**
 * Builds SYNTHETIC "scanned" pages for OCR tests: text drawn onto an image (no text
 * layer), and PDFs whose pages are only such images. Nothing here is real data.
 */
import { createCanvas } from "@napi-rs/canvas";

/** A white page image with black text, like a clean scan. */
export function makeScanImage(lines: string[], format: "png" | "jpeg" = "png", width = 1700, height = 1100): Uint8Array {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#000000";
  ctx.font = "48px sans-serif";
  lines.forEach((l, i) => ctx.fillText(l, 100, 160 + i * 80));
  return new Uint8Array(format === "png" ? canvas.toBuffer("image/png") : canvas.toBuffer("image/jpeg", 92));
}

/** A PDF whose pages are JPEG images only (null = blank page). Page size US Letter landscape. */
export function makeScanPdf(pages: (Uint8Array | null)[], imgW = 1700, imgH = 1100, mediaBox = [792, 612]): Uint8Array {
  const box = `[0 0 ${mediaBox[0]} ${mediaBox[1]}]`;
  const parts: Buffer[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (b: Buffer) => (parts.push(b), (length += b.length));
  const objs: (string | [string, Uint8Array])[] = [];
  const add = (o: string | [string, Uint8Array]) => (objs.push(o), objs.length);
  const pagesRef = 1 + pages.length * 3;
  const pageIds = pages.map((jpeg) => {
    if (!jpeg) {
      const content = add("<< /Length 0 >>\nstream\n\nendstream");
      add("null");
      return add(`<< /Type /Page /Parent ${pagesRef} 0 R /MediaBox ${box} /Contents ${content} 0 R >>`);
    }
    const img = add([
      `<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`,
      jpeg,
    ]);
    const ops = `q ${mediaBox[0]} 0 0 ${mediaBox[1]} 0 0 cm /Im1 Do Q`;
    const content = add(`<< /Length ${ops.length} >>\nstream\n${ops}\nendstream`);
    return add(
      `<< /Type /Page /Parent ${pagesRef} 0 R /MediaBox ${box} /Contents ${content} 0 R /Resources << /XObject << /Im1 ${img} 0 R >> >> >>`,
    );
  });
  const pagesId = add(`<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
  if (pagesId !== pagesRef) throw new Error("makeScanPdf object numbering bug");
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  push(Buffer.from("%PDF-1.4\n"));
  objs.forEach((o, i) => {
    offsets.push(length);
    if (typeof o === "string") push(Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`));
    else {
      push(Buffer.from(`${i + 1} 0 obj\n${o[0]}\nstream\n`));
      push(Buffer.from(o[1]));
      push(Buffer.from("\nendstream\nendobj\n"));
    }
  });
  const xref = length;
  push(Buffer.from(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`));
  push(Buffer.from(`trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
  return new Uint8Array(Buffer.concat(parts));
}
