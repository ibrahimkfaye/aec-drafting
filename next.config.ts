import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // pdf.js loads its own worker file at runtime; keep it out of the server bundle.
  // The OCR engine starts its own worker thread and loads WASM + language data from disk.
  serverExternalPackages: ["pdfjs-dist", "tesseract.js", "tesseract.js-core", "@tesseract.js-data/eng", "@napi-rs/canvas"],
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
