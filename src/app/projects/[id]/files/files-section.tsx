import { BLOCK_REASON_TEXT, formatBytes } from "@/lib/files";
import { formatUtc } from "@/lib/format";
import { memberLabel, type Member } from "@/lib/members";
import type { SourceVersionRow, SourceWithVersions } from "@/lib/sources";
import { UploadForm } from "./upload-form";

function statusLabel(v: SourceVersionRow) {
  if (v.status === "stored") return { text: "Stored", cls: "text-emerald-800" };
  if (v.status === "blocked") return { text: `Blocked: ${BLOCK_REASON_TEXT[v.block_reason!]}`, cls: "text-red-800" };
  return v.incomplete ? { text: "Upload incomplete", cls: "text-red-800" } : { text: "Uploading…", cls: "text-zinc-600" };
}

const SCAN_TEXT = { not_scanned: "Not scanned", clean: "Scanned: clean", infected: "Scan: INFECTED", scan_error: "Scan failed" };

export function FilesSection({
  projectId,
  sources,
  members,
  canUpload,
  archived,
}: {
  projectId: string;
  sources: SourceWithVersions[];
  members: Member[];
  canUpload: boolean;
  archived: boolean;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Source files</h2>
      {canUpload && !archived && <UploadForm projectId={projectId} sources={sources.map((s) => ({ id: s.id, title: s.title }))} />}
      {sources.length === 0 ? (
        <p className="text-sm text-zinc-600">No files yet.</p>
      ) : (
        <ul className="flex flex-col gap-4" data-testid="source-list">
          {sources.map((s) => (
            <li key={s.id} className="rounded border border-zinc-200 p-3" data-testid="source">
              <p className="font-medium">{s.title}</p>
              <table className="mt-2 w-full text-left text-sm">
                <thead className="text-zinc-500">
                  <tr>
                    <th className="pr-3 font-medium">Version</th>
                    <th className="pr-3 font-medium">File</th>
                    <th className="pr-3 font-medium">Size</th>
                    <th className="pr-3 font-medium">Status</th>
                    <th className="pr-3 font-medium">Malware scan</th>
                    <th className="pr-3 font-medium">Uploaded</th>
                    <th className="font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {s.versions.map((v) => {
                    const st = statusLabel(v);
                    return (
                      <tr key={v.id} data-testid="source-version" className="border-t border-zinc-100">
                        <td className="pr-3">v{v.version_number}</td>
                        <td className="pr-3 break-all">{v.original_filename}</td>
                        <td className="pr-3">{formatBytes(v.byte_size)}</td>
                        <td className={`pr-3 ${st.cls}`} data-testid="version-status">
                          {st.text}
                        </td>
                        <td className="pr-3">{v.status === "stored" ? SCAN_TEXT[v.scan_status] : "—"}</td>
                        <td className="pr-3">
                          {memberLabel(members, v.uploaded_by)} · {formatUtc(v.created_at)}
                        </td>
                        <td>
                          {v.status === "stored" && (
                            <a className="underline" href={`/projects/${projectId}/files/${v.id}`} data-testid="download">
                              Download
                            </a>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
