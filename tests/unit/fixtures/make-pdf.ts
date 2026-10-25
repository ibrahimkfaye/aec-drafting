/**
 * Builds tiny SYNTHETIC PDFs in memory for tests (no files, no real documents).
 * Each string becomes one page; an empty string makes a page with no text layer,
 * which is how a scanned page looks to a text extractor.
 */
export function makePdf(pages: string[]): Uint8Array {
  const objs: string[] = [];
  const add = (s: string) => (objs.push(s), objs.length);
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pagesRef = 2 + pages.length * 2; // object number the Pages node will get
  const pageIds = pages.map((t) => {
    const lines = t.split("\n");
    const ops = t ? `BT /F1 12 Tf 14 TL 72 720 Td ${lines.map((l) => `(${l.replace(/([()\\])/g, "\\$1")}) Tj T*`).join(" ")} ET` : "";
    const content = add(`<< /Length ${ops.length} >>\nstream\n${ops}\nendstream`);
    return add(
      `<< /Type /Page /Parent ${pagesRef} 0 R /MediaBox [0 0 612 792] /Contents ${content} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`,
    );
  });
  const pagesId = add(`<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
  if (pagesId !== pagesRef) throw new Error("makePdf object numbering bug");
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}
