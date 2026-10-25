import { expect, test, type Page } from "@playwright/test";
import { clearInbox, countMessagesTo, waitForSignInLink } from "./mailpit";

// Fail if the Next.js developer overlay reports a problem on the page.
test.afterEach(async ({ page }) => {
  await expect(page.locator("[data-nextjs-fix-card]")).toHaveCount(0);
});

async function requestLink(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("status")).toContainText(
    "If that email belongs to a pilot user",
  );
}

test("signed-out visitors are sent to sign-in", async ({ page }) => {
  for (const path of ["/", "/dashboard", "/no-access"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login$/);
  }
});

test("tampered or wrong-type links never show a working sign-in button", async ({
  page,
}) => {
  for (const q of ["token_hash=abc&type=signup", "token_hash=<script>&type=email", "type=email"]) {
    await page.goto(`/auth/confirm?${q}`);
    await expect(page.getByText("This sign-in link is not valid.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue signing in" })).toHaveCount(0);
  }
});

test.describe("with the local test inbox", () => {
  test.beforeEach(async () => {
    await clearInbox();
  });

  test("magic link signs a firm member in, shows firm and role, and signs out", async ({
    page,
  }) => {
    await requestLink(page, "author@example.test");
    const link = await waitForSignInLink("author@example.test");

    // Opening the link alone must NOT sign in (protects against email link scanners).
    await page.goto(link);
    await expect(
      page.getByRole("button", { name: "Continue signing in" }),
    ).toBeVisible();
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);

    await page.goto(link);
    await page.getByRole("button", { name: "Continue signing in" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(
      page.getByRole("heading", { name: "SYNTHETIC Sample Firm (dev only)" }),
    ).toBeVisible();
    await expect(page.getByTestId("user-role")).toHaveText("author");

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("a sign-in link works only once", async ({ page, context }) => {
    await requestLink(page, "viewer@example.test");
    const link = await waitForSignInLink("viewer@example.test");
    await page.goto(link);
    await page.getByRole("button", { name: "Continue signing in" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    await context.clearCookies();
    await page.goto(link);
    await page.getByRole("button", { name: "Continue signing in" }).click();
    await expect(page).toHaveURL(/\/login\?error=link_invalid$/);
  });

  test("a signed-in user without a firm sees the no-access page", async ({
    page,
  }) => {
    await requestLink(page, "nomember@example.test");
    await page.goto(await waitForSignInLink("nomember@example.test"));
    await page.getByRole("button", { name: "Continue signing in" }).click();
    await expect(page).toHaveURL(/\/no-access$/);
    await expect(
      page.getByRole("heading", { name: "No firm access" }),
    ).toBeVisible();
  });

  test("unknown emails get the same message, and no email is sent", async ({
    page,
  }) => {
    // Control: delivery works for a real user, so a zero count below means
    // "not sent to the stranger", not "email is broken for everyone".
    await requestLink(page, "admin@example.test");
    await waitForSignInLink("admin@example.test");
    await requestLink(page, "stranger@example.test");
    await page.waitForTimeout(3000);
    expect(await countMessagesTo("stranger@example.test")).toBe(0);
  });

  test("forged token is rejected by Supabase", async ({ page }) => {
    await page.goto("/auth/confirm?token_hash=forged123&type=email");
    await page.getByRole("button", { name: "Continue signing in" }).click();
    await expect(page).toHaveURL(/\/login\?error=link_invalid$/);
  });
});
