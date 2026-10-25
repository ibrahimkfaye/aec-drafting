"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { SUPPORTED_SUMMARY } from "@/lib/files";
import { finishUpload, startUpload } from "./actions";

type Props = { projectId: string; sources: { id: string; title: string }[] };
type Status = { tone: "info" | "ok" | "warn" | "error"; text: string } | null;

const TONE = {
  info: "border-zinc-200 bg-zinc-50 text-zinc-800",
  ok: "border-emerald-200 bg-emerald-50 text-emerald-900",
  warn: "border-amber-200 bg-amber-50 text-amber-900",
  error: "border-red-200 bg-red-50 text-red-800",
};

export function UploadForm({ projectId, sources }: Props) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [sourceId, setSourceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return setStatus({ tone: "error", text: "Choose a file first." });
    setBusy(true);
    try {
      setStatus({ tone: "info", text: "Checking file…" });
      const start = await startUpload({ projectId, sourceId, filename: file.name, size: file.size });
      if (start.kind === "blocked") {
        setStatus({ tone: "warn", text: `Blocked: ${start.message} It has been recorded as blocked and was not uploaded.` });
        return;
      }
      if (start.kind === "error") return setStatus({ tone: "error", text: start.message });

      setStatus({ tone: "info", text: "Uploading…" });
      const { error } = await createClient()
        .storage.from("project-files")
        .uploadToSignedUrl(start.path, start.token, file, { contentType: start.mime });
      // Even if the browser reports an error, let the server decide what arrived.
      setStatus({ tone: "info", text: "Verifying contents…" });
      const done = await finishUpload({ projectId, versionId: start.versionId });
      if (done.kind === "stored") setStatus({ tone: "ok", text: `Stored: ${file.name}` });
      else if (done.kind === "blocked") setStatus({ tone: "warn", text: `Blocked: ${done.message}.` });
      else setStatus({ tone: "error", text: error ? "The upload did not complete. Please try again." : done.message });
    } catch {
      setStatus({ tone: "error", text: "The upload did not complete. Please try again." });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded border border-zinc-200 p-4">
      <p className="text-xs text-amber-900">
        Development build: upload only synthetic or public sample files. Malware scanning is not set up yet.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="file" className="text-sm font-medium">
            File
          </label>
          <input id="file" ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.txt" className="text-sm" disabled={busy} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="source" className="text-sm font-medium">
            Upload as
          </label>
          <select
            id="source"
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
            disabled={busy}
          >
            <option value="">A new source document</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                New version of: {s.title}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" disabled={busy} className="rounded bg-zinc-900 px-4 py-1.5 text-sm text-white disabled:opacity-50">
          {busy ? "Working…" : "Upload"}
        </button>
      </div>
      <p className="text-xs text-zinc-500">Accepted: {SUPPORTED_SUMMARY}. Other types are recorded as blocked.</p>
      {status && (
        <p role="status" data-testid="upload-status" className={`rounded border p-2 text-sm ${TONE[status.tone]}`}>
          {status.text}
        </p>
      )}
    </form>
  );
}
