import { describe, expect, it } from "vitest";
import { isPublicPath } from "@/lib/routes";
import { confirmParamsSchema, emailSchema } from "@/lib/validation";

describe("public paths", () => {
  it.each(["/login", "/auth/confirm"])("%s is reachable signed out", (p) => {
    expect(isPublicPath(p)).toBe(true);
  });
  it.each(["/", "/dashboard", "/no-access", "/loginx", "/auth", "/auth/confirmx", "/projects/1"])(
    "%s requires sign-in",
    (p) => {
      expect(isPublicPath(p)).toBe(false);
    },
  );
});

describe("email validation", () => {
  it("normalizes case and whitespace", () => {
    expect(emailSchema.parse("  Author@Example.TEST ")).toBe("author@example.test");
  });
  it.each(["", "not-an-email", "a@", null, 42, `${"a".repeat(250)}@x.test`])("rejects %s", (v) => {
    expect(emailSchema.safeParse(v).success).toBe(false);
  });
});

describe("magic-link confirm parameters", () => {
  it("accepts a token hash with type=email", () => {
    expect(confirmParamsSchema.safeParse({ token_hash: "abc123_DEF-9", type: "email" }).success).toBe(true);
  });
  it.each([
    { token_hash: "abc", type: "signup" },
    { token_hash: "abc", type: "recovery" },
    { token_hash: "", type: "email" },
    { token_hash: "abc<script>", type: "email" },
    { token_hash: "a".repeat(513), type: "email" },
    { type: "email" },
  ])("rejects %o", (v) => {
    expect(confirmParamsSchema.safeParse(v).success).toBe(false);
  });
});
