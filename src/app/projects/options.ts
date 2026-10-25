import "server-only";
import { DOCUMENT_TYPES } from "@/config/document-types";
import { eligibleReviewers, type Member } from "@/lib/projects";

export const documentTypeOptions = () => DOCUMENT_TYPES.map((d) => ({ value: d.key, label: d.label }));

export const reviewerOptions = (members: Member[]) =>
  eligibleReviewers(members).map((r) => ({
    value: r.user_id,
    label: `${r.display_name || r.email || "Unnamed member"} (${r.role})`,
  }));
