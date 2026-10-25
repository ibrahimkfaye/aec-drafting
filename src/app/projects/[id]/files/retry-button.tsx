"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { requestVerification } from "./actions";
import { followJob } from "./upload-form";

/** Re-queues verification for one of the user's own unfinished uploads. */
export function RetryVerification({ projectId, versionId }: { projectId: string; versionId: string }) {
  const router = useRouter();
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function retry() {
    setBusy(true);
    const req = await requestVerification({ projectId, versionId });
    if (req.kind === "error") setText(req.message);
    else {
      const r = await followJob(projectId, versionId, req.jobId, setText);
      setText(r.text === "stored" ? "Stored" : r.text);
    }
    setBusy(false);
    router.refresh();
  }
  return (
    <span className="flex flex-col gap-1">
      <button type="button" onClick={retry} disabled={busy} className="w-fit underline disabled:opacity-50" data-testid="retry-verification">
        {busy ? "Retrying…" : "Retry"}
      </button>
      {text && <span className="text-xs text-zinc-600">{text}</span>}
    </span>
  );
}
