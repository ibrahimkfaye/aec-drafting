import { describe, expect, it } from "vitest";
import { projectFieldsSchema, projectRefSchema, readProjectForm } from "@/lib/project-schema";
import { eligibleReviewers, memberLabel, type Member } from "@/lib/members";
import { describeAudit, formatUtc } from "@/lib/format";
import { documentTypeLabel } from "@/config/document-types";

const valid = {
  name: "  SYNTHETIC Bridge Inspection  ",
  client_name: "SYNTHETIC County",
  location: "SYNTHETIC Site",
  document_type: "sample_technical_memo",
  scope_instructions: "",
  assigned_reviewer_id: "",
};

describe("project fields", () => {
  it("accepts valid input, trims text, and treats an empty reviewer as unassigned", () => {
    const r = projectFieldsSchema.parse(valid);
    expect(r.name).toBe("SYNTHETIC Bridge Inspection");
    expect(r.assigned_reviewer_id).toBeNull();
  });

  it.each(["name", "client_name", "location"] as const)("requires %s (whitespace is not enough)", (f) => {
    const r = projectFieldsSchema.safeParse({ ...valid, [f]: "   " });
    expect(r.success).toBe(false);
  });

  it("rejects an unconfigured document type", () => {
    expect(projectFieldsSchema.safeParse({ ...valid, document_type: "geotech_report" }).success).toBe(false);
  });

  it("rejects a reviewer value that is not a user id", () => {
    expect(projectFieldsSchema.safeParse({ ...valid, assigned_reviewer_id: "riley" }).success).toBe(false);
  });

  it("enforces length limits", () => {
    expect(projectFieldsSchema.safeParse({ ...valid, name: "x".repeat(201) }).success).toBe(false);
    expect(projectFieldsSchema.safeParse({ ...valid, scope_instructions: "x".repeat(20001) }).success).toBe(false);
  });

  it("ignores fields a user must not control (firm, creator, version, status)", () => {
    const fd = new FormData();
    Object.entries({ ...valid, org_id: "x", created_by: "x", row_version: "9", status: "archived" }).forEach(
      ([k, v]) => fd.set(k, v),
    );
    const read = readProjectForm(fd);
    expect(Object.keys(read).sort()).toEqual(Object.keys(valid).sort());
    expect(Object.keys(projectFieldsSchema.parse(read))).not.toContain("org_id");
  });
});

describe("project version reference", () => {
  it("requires a uuid and a positive integer version", () => {
    expect(projectRefSchema.safeParse({ id: crypto.randomUUID(), row_version: "3" }).success).toBe(true);
    expect(projectRefSchema.safeParse({ id: "1", row_version: "3" }).success).toBe(false);
    expect(projectRefSchema.safeParse({ id: crypto.randomUUID(), row_version: "0" }).success).toBe(false);
    expect(projectRefSchema.safeParse({ id: crypto.randomUUID(), row_version: "abc" }).success).toBe(false);
  });
});

describe("members", () => {
  const members: Member[] = [
    { user_id: "a", display_name: "Avery", email: "a@x.test", role: "admin" },
    { user_id: "b", display_name: "", email: "b@x.test", role: "author" },
    { user_id: "r", display_name: "Riley", email: "r@x.test", role: "reviewer" },
    { user_id: "v", display_name: "Val", email: "v@x.test", role: "viewer" },
  ];
  it("only reviewers and admins are eligible reviewers", () => {
    expect(eligibleReviewers(members).map((m) => m.user_id)).toEqual(["a", "r"]);
  });
  it("labels members by name, then email, and flags people no longer in the firm", () => {
    expect(memberLabel(members, "a")).toBe("Avery");
    expect(memberLabel(members, "b")).toBe("b@x.test");
    expect(memberLabel(members, "gone")).toBe("Former member");
    expect(memberLabel(members, null)).toBe("—");
  });
});

describe("display helpers", () => {
  it("formats timestamps in UTC", () => {
    expect(formatUtc("2026-10-25T03:08:49.123Z")).toBe("2026-10-25 03:08 UTC");
    expect(formatUtc("nonsense")).toBe("—");
  });
  it("describes audit events in plain language", () => {
    expect(describeAudit("project.created")).toBe("Created the project");
    expect(describeAudit("project.updated", ["client_name", "location"])).toBe("Edited client, location");
    expect(describeAudit("project.status_changed", ["status"])).toBe("Changed status");
  });
  it("labels unknown document types instead of hiding them", () => {
    expect(documentTypeLabel("sample_technical_memo")).toContain("placeholder");
    expect(documentTypeLabel("legacy")).toBe("Unknown type (legacy)");
  });
});

import { conflictFlags } from "@/lib/conflict-flags";

describe("conflict flags", () => {
  it("marks facts in open conflicts and the non-prevailing facts of resolved ones", () => {
    const { inOpen, lost } = conflictFlags([
      { status: "open", prevailing_fact_id: null, fact_ids: ["a", "b"] },
      { status: "resolved", prevailing_fact_id: "c", fact_ids: ["c", "d", "e"] },
    ]);
    expect([...inOpen].sort()).toEqual(["a", "b"]);
    expect([...lost].sort()).toEqual(["d", "e"]);
  });
});
