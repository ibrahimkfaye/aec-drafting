import { expect, test } from "@playwright/test";
import { createProject, signIn } from "./helpers";

test("author creates a project; required fields are enforced; history records it", async ({ page }) => {
  await signIn(page, "author@example.test");
  await page.goto("/projects/new");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByText("Project name is required.")).toBeVisible();
  await expect(page.getByText("Choose a document type.")).toBeVisible();

  const p = await createProject(page, { reviewer: "Riley Reviewer (synthetic) (reviewer)" });
  await expect(page.getByTestId("project-reviewer")).toHaveText("Riley Reviewer (synthetic)");
  await expect(page.getByTestId("project-history")).toContainText("Alex Author (synthetic) · Created the project");

  await page.goto("/dashboard");
  await expect(page.getByRole("link", { name: p.name })).toBeVisible();
});

test("reviewer picker lists only reviewers and admins", async ({ page }) => {
  await signIn(page, "author@example.test");
  await page.goto("/projects/new");
  const options = await page.getByLabel("Assigned reviewer").locator("option").allTextContents();
  expect(options).toEqual([
    "Not assigned yet",
    "Avery Admin (synthetic) (admin)",
    "Riley Reviewer (synthetic) (reviewer)",
  ]);
});

test("viewer can read projects but cannot create or edit them", async ({ page, browser }) => {
  const authorCtx = await browser.newContext();
  const author = await authorCtx.newPage();
  await signIn(author, "author@example.test");
  const p = await createProject(author);
  await authorCtx.close();

  await signIn(page, "viewer@example.test");
  await expect(page.getByRole("link", { name: "New project" })).toHaveCount(0);
  await page.goto("/projects/new");
  await expect(page.getByTestId("not-allowed")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create project" })).toHaveCount(0);

  await page.goto(`/projects/${p.id}`);
  await expect(page.getByRole("heading", { name: p.name })).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Archive project" })).toHaveCount(0);
  await page.goto(`/projects/${p.id}/edit`);
  await expect(page.getByTestId("not-allowed")).toBeVisible();
});

test("a stale edit is refused instead of overwriting newer changes", async ({ page, context }) => {
  await signIn(page, "author@example.test");
  const p = await createProject(page);

  const tab1 = page;
  const tab2 = await context.newPage();
  await tab1.goto(`/projects/${p.id}/edit`);
  await tab2.goto(`/projects/${p.id}/edit`);

  await tab1.getByLabel("Client").fill("SYNTHETIC Client — first save");
  await tab1.getByRole("button", { name: "Save changes" }).click();
  await expect(tab1.getByTestId("project-client")).toHaveText("SYNTHETIC Client — first save");

  await tab2.getByLabel("Client").fill("SYNTHETIC Client — stale save");
  await tab2.getByRole("button", { name: "Save changes" }).click();
  await expect(tab2.getByTestId("conflict-message")).toContainText("Your edits were NOT saved");
  await expect(tab2.getByLabel("Client")).toHaveValue("SYNTHETIC Client — stale save"); // typing is kept

  await tab1.goto(`/projects/${p.id}`);
  await expect(tab1.getByTestId("project-client")).toHaveText("SYNTHETIC Client — first save");
  await expect(tab1.getByTestId("project-history")).toContainText("Edited client");
});

test("archive and restore", async ({ page }) => {
  await signIn(page, "admin@example.test");
  const p = await createProject(page);
  await page.getByRole("button", { name: "Archive project" }).click();
  await expect(page.getByTestId("project-status")).toHaveText("Archived");
  await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);
  await page.getByRole("button", { name: "Restore project" }).click();
  await expect(page.getByTestId("project-status")).toHaveText("Active");
  await expect(page.getByTestId("project-history")).toContainText("Changed status");
  expect(p.id).toBeTruthy();
});

test("another firm cannot see or open this firm's project", async ({ page, browser }) => {
  const authorCtx = await browser.newContext();
  const author = await authorCtx.newPage();
  await signIn(author, "author@example.test");
  const p = await createProject(author);
  await authorCtx.close();

  await signIn(page, "other-admin@example.test");
  await expect(page.getByRole("heading", { name: "SYNTHETIC Other Firm (dev only)" })).toBeVisible();
  await expect(page.getByRole("link", { name: p.name })).toHaveCount(0);
  for (const path of [`/projects/${p.id}`, `/projects/${p.id}/edit`]) {
    await page.goto(path);
    await expect(page.getByText("This page could not be found.")).toBeVisible();
    await expect(page.getByText(p.name)).toHaveCount(0);
  }
});
