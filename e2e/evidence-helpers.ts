/** Shared helpers for evidence E2E tests. Everything is SYNTHETIC. */
import { expect, type Browser, type Page } from "@playwright/test";
import { createProject, signIn, upload } from "./helpers";

export const PDF = Buffer.from("%PDF-1.4\n% SYNTHETIC test file - not a real document\n%%EOF\n");
export const FILE = "SYNTHETIC-inspection.pdf";

/** Author creates a project with one stored file; returns its id. */
export async function projectWithFile(browser: Browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signIn(page, "author@example.test");
  const p = await createProject(page);
  await upload(page, FILE, PDF, "application/pdf");
  await ctx.close();
  return p.id;
}

export async function asUser(browser: Browser, email: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signIn(page, email);
  return { page, close: () => ctx.close() };
}

export const addSection = (page: Page) => page.locator("section").filter({ has: page.getByRole("heading", { name: "Add a fact" }) });
export const card = (page: Page, statement: string) => page.getByTestId("fact-card").filter({ hasText: statement });

export async function addFact(page: Page, projectId: string, statement: string) {
  await page.goto(`/projects/${projectId}/evidence`);
  const form = addSection(page);
  await form.getByLabel("Fact (one clear statement)").fill(statement);
  await form.getByLabel("Source file").selectOption({ label: `${FILE} (v1)` });
  await form.getByLabel("Page", { exact: true }).fill("4");
  await form.getByLabel("Supporting excerpt (copied from the source)").fill(`SYNTHETIC excerpt for: ${statement}`);
  await form.getByRole("button", { name: "Add candidate fact" }).click();
  await expect(card(page, statement)).toBeVisible();
}

