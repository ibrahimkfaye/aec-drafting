"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { requestExtraction, requestOcr } from "./actions";

/** Starts or retries text extraction (or local OCR) for a stored file, then refreshes the list. */
export function ExtractButton({
  projectId,
  versionId,
  label,
  kind = "extract",
}: {
  projectId: string;
  versionId: string;
  label: string;
  kind?: "extract" | "ocr";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function go() {
    setBusy(true);
    const r = await (kind === "ocr" ? requestOcr : requestExtraction)({ projectId, versionId });
    setMsg(r.kind === "error" ? r.message : kind === "ocr" ? "Running OCR…" : "Extracting…");
    // Give the background job time (OCR takes seconds per page), refreshing to show its result.
    for (let i = 0; i < (kind === "ocr" ? 60 : 20) && r.kind !== "error"; i++) {
      await new Promise((res) => setTimeout(res, 1000));
      router.refresh();
    }
    setBusy(false);
  }
  return (
    <span className="flex flex-col gap-0.5">
      <button type="button" onClick={go} disabled={busy} className="w-fit underline disabled:opacity-50" data-testid={kind === "ocr" ? "run-ocr" : "extract-text"}>
        {busy ? "Working…" : label}
      </button>
      {msg && <span className="text-xs text-zinc-600">{msg}</span>}
    </span>
  );
}
