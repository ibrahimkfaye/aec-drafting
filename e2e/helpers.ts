import { expect, type Page } from "@playwright/test";
import { clearInbox, waitForSignInLink } from "./mailpit";

/** Signs in a SYNTHETIC seeded user through the real magic-link flow. */
export async function signIn(page: Page, email: string) {
  await clearInbox();
  await page.goto("/login");
  await page.getByLabel("Work email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("status")).toContainText("If that email belongs to a pilot user");
  await page.goto(await waitForSignInLink(email));
  await page.getByRole("button", { name: "Continue signing in" }).click();
  await expect(page).not.toHaveURL(/\/auth\/confirm/);
}

/** Creates a project via the UI and returns its id. Names are unique per call. */
export async function createProject(page: Page, overrides: { name?: string; reviewer?: string } = {}) {
  const name = overrides.name ?? `SYNTHETIC Project ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  await page.goto("/projects/new");
  await page.getByLabel("Project name", { exact: true }).fill(name);
  await page.getByLabel("Client", { exact: true }).fill("SYNTHETIC Client");
  await page.getByLabel("Location", { exact: true }).fill("SYNTHETIC Location");
  await page.getByLabel("Document type", { exact: true }).selectOption("sample_technical_memo");
  await page.getByLabel("Scope and instructions", { exact: true }).fill("SYNTHETIC scope text for testing.");
  if (overrides.reviewer) await page.getByLabel("Assigned reviewer", { exact: true }).selectOption({ label: overrides.reviewer });
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  const id = page.url().match(/\/projects\/([0-9a-f-]{36})$/)?.[1];
  if (!id) throw new Error(`Unexpected URL after create: ${page.url()}`);
  return { id, name };
}
