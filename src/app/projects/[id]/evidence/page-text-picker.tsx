"use client";

import { useRef, useState } from "react";
import { getPageText, type PageTextResult } from "./actions";

const MESSAGES: Record<Exclude<PageTextResult["status"], "ok">, string> = {
  empty: "This page has no extracted text (it may be a drawing or a scan). Type the excerpt from the original.",
  needs_ocr: "This file has no text layer (scanned or an image). Type the excerpt from the original.",
  not_extracted: "This file's text hasn't been extracted yet. Type the excerpt, or extract its text from the project page.",
  no_such_page: "That page number is beyond the end of the file.",
  error: "Choose a source file and a page number first.",
};

/**
 * Shows one page of extracted text so the person can select the excerpt instead
 * of retyping it. The text is UNTRUSTED document content: shown as plain text only.
 */
export function PageTextPicker({
  projectId,
  getSource,
  getPage,
  setExcerpt,
}: {
  projectId: string;
  getSource: () => string;
  getPage: () => string;
  setExcerpt: (text: string) => void;
}) {
  const [result, setResult] = useState<PageTextResult | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const panel = useRef<HTMLPreElement>(null);

  async function load() {
    setHint(null);
    const versionId = getSource();
    const page = Number(getPage());
    if (!versionId || !Number.isInteger(page) || page < 1) return setResult({ status: "error" });
    setResult(await getPageText({ projectId, versionId, page }));
  }

  function applySelection() {
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? "";
    const inside = !!sel && sel.rangeCount > 0 && !!panel.current?.contains(sel.getRangeAt(0).commonAncestorContainer);
    if (!text || !inside) return setHint("Select the excerpt in the page text above first.");
    setExcerpt(text.slice(0, 2000));
    setHint(text.length > 2000 ? "Selection was longer than 2,000 characters and was shortened." : "Excerpt filled in from the page text.");
  }

  return (
    <div className="flex flex-col gap-2">
      <div>
        <button type="button" onClick={load} className="text-sm underline" data-testid="show-page-text">
          Show this page&rsquo;s text
        </button>
      </div>
      {result && result.status !== "ok" && (
        <p className="text-sm text-amber-900" data-testid="page-text-message">
          {MESSAGES[result.status]}
        </p>
      )}
      {result?.status === "ok" && (
        <>
          <pre
            ref={panel}
            className="max-h-64 overflow-auto whitespace-pre-wrap rounded border border-zinc-200 bg-zinc-50 p-3 font-sans text-sm"
            data-testid="picker-text"
          >
            {result.text}
          </pre>
          <div className="flex items-center gap-3">
            <button type="button" onClick={applySelection} className="rounded border border-zinc-300 px-3 py-1 text-sm">
              Use selected text as excerpt
            </button>
            <span className="text-xs text-zinc-500">Extracted text — confirm against the original before approving.</span>
          </div>
        </>
      )}
      {hint && (
        <p className="text-xs text-zinc-700" data-testid="picker-hint">
          {hint}
        </p>
      )}
    </div>
  );
}
