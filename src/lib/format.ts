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
  const fields = changed.map((f) => FIELD_LABELS[f] ?? f).join(", ");
  if (action === "project.status_changed") {
    const others = changed.filter((f) => f !== "status").map((f) => FIELD_LABELS[f] ?? f);
    return others.length ? `Changed status and edited ${others.join(", ")}` : "Changed status";
  }
  if (action === "project.updated") return fields ? `Edited ${fields}` : "Saved without changes";
  return action;
}
