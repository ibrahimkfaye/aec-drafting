/** Formats an ISO timestamp as "YYYY-MM-DD HH:MM UTC" (unambiguous across offices). */
export function formatUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export const FIELD_LABELS: Record<string, string> = {
  name: "project name",
  client_name: "client",
  location: "location",
  document_type: "document type",
  scope_instructions: "scope and instructions",
  assigned_reviewer_id: "assigned reviewer",
  status: "status",
};

export function describeAudit(action: string, changed: string[] = []): string {
  if (action === "project.created") return "Created the project";
  if (action === "fact.created") return "Proposed a fact";
  if (action === "fact.revised") return "Edited a fact (new revision)";
  if (action === "fact.approved") return "Approved a fact";
  if (action === "fact.rejected") return "Rejected a fact";
  if (action === "source_version.upload_started") return "Started a file upload";
  if (action === "source_version.stored") return "Stored a file";
  if (action === "source_version.blocked") return "A file was blocked";
  if (action === "source_version.bytes_cleared") return "Removed a blocked file's contents from storage";
  if (action === "snapshot.locked") return "Locked an evidence snapshot";
  if (action === "source_text.extracted") return "Extracted a file's text";
  if (action === "source_text.needs_ocr") return "File has no text layer (needs OCR)";
  if (action === "source_text.ocr_recognized") return "Recognized a file's text with OCR";
  if (action === "source_text.ocr_no_text_found") return "OCR found no text in a file";
  if (action === "gap.created") return "Raised a gap";
  if (action === "gap.resolved") return "Resolved a gap";
  if (action === "gap.dismissed") return "Dismissed a gap";
  if (action === "conflict.created") return "Raised a conflict";
  if (action === "conflict.resolved") return "Resolved a conflict";
  if (action === "job.queued") return "Queued a background check";
  if (action === "job.succeeded") return "Background check finished";
  if (action === "job.failed") return "Background check failed";
  const fields = changed.map((f) => FIELD_LABELS[f] ?? f).join(", ");
  if (action === "project.status_changed") {
    const others = changed.filter((f) => f !== "status").map((f) => FIELD_LABELS[f] ?? f);
    return others.length ? `Changed status and edited ${others.join(", ")}` : "Changed status";
  }
  if (action === "project.updated") return fields ? `Edited ${fields}` : "Saved without changes";
  return action;
}

export type AuditDetails = {
  changed_fields?: string[];
  revision_number?: number;
  self_approved?: boolean;
  self_closed?: boolean;
  snapshot_number?: number;
  fact_count?: number;
  gap_count?: number;
  excluded_count?: number;
  version_number?: number;
  block_reason?: string;
  error_code?: string;
  attempts?: number;
  page_count?: number;
  pages_with_text?: number;
  mean_confidence?: number;
};

const BLOCK_TEXT: Record<string, string> = {
  unsupported_type: "unsupported file type",
  too_large: "larger than 25 MB",
  empty_file: "empty file",
  signature_mismatch: "contents don't match extension",
  invalid_text: "not valid plain text",
  size_mismatch: "size mismatch",
  missing_upload: "upload didn't arrive",
  abandoned_upload: "upload never finished",
};

/** Short, content-free extra detail for one audit event (numbers, flags, codes only). */
export function auditExtra(action: string, d: AuditDetails = {}): string[] {
  const out: string[] = [];
  if (action.startsWith("fact.") && d.revision_number) out.push(`revision ${d.revision_number}`);
  if (action === "fact.approved" && d.self_approved) out.push("self-approved by admin");
  if ((action === "gap.resolved" || action === "gap.dismissed" || action === "conflict.resolved") && d.self_closed) {
    out.push("closed by the admin who raised it");
  }
  if (action === "snapshot.locked" && d.snapshot_number) {
    out.push(`snapshot ${d.snapshot_number}: ${d.fact_count ?? 0} facts, ${d.gap_count ?? 0} open gaps, ${d.excluded_count ?? 0} left out`);
  }
  if (action.startsWith("source_version.") && d.version_number) out.push(`v${d.version_number}`);
  if (action === "source_version.blocked" && d.block_reason) out.push(BLOCK_TEXT[d.block_reason] ?? d.block_reason);
  if (action === "job.failed" && d.error_code) out.push(`error: ${d.error_code}`);
  if (action === "source_text.extracted" && d.page_count != null) out.push(`${d.pages_with_text ?? 0} of ${d.page_count} pages have text`);
  if (action === "source_text.ocr_recognized" && d.page_count != null) {
    out.push(`${d.pages_with_text ?? 0} of ${d.page_count} pages have text`);
    if (d.mean_confidence != null) out.push(`engine confidence ${Math.round(Number(d.mean_confidence))}%`);
  }
  return out;
}

/** Filter groups for the history page (action name prefixes). */
export const AUDIT_GROUPS = {
  projects: { label: "Projects", prefix: "project." },
  files: { label: "Files", prefix: "source" },
  facts: { label: "Facts", prefix: "fact." },
  gaps: { label: "Gaps", prefix: "gap." },
  conflicts: { label: "Conflicts", prefix: "conflict." },
  snapshots: { label: "Snapshots", prefix: "snapshot." },
  jobs: { label: "Background jobs", prefix: "job." },
} as const;
export type AuditGroup = keyof typeof AUDIT_GROUPS;
