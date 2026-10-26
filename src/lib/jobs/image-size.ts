/**
 * Reads an image's pixel dimensions from its header WITHOUT decoding it, so an
 * untrusted file that would expand to billions of pixels is refused before any
 * decoder sees it. Returns null if the header can't be read.
 */
export function imageSize(type: "png" | "jpeg", b: Uint8Array): { width: number; height: number } | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (type === "png") {
    // 8-byte signature, then the IHDR chunk: length(4) "IHDR"(4) width(4) height(4)
    if (b.length < 24 || String.fromCharCode(...b.subarray(12, 16)) !== "IHDR") return null;
    return { width: dv.getUint32(16), height: dv.getUint32(20) };
  }
  // JPEG: walk the marker segments until a start-of-frame marker.
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2; // markers without a length
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // end of image / start of scan before any frame
    const len = dv.getUint16(i + 2);
    if (len < 2) return null;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (i + 9 > b.length) return null;
      return { width: dv.getUint16(i + 7), height: dv.getUint16(i + 5) };
    }
    i += 2 + len;
  }
  return null;
}
