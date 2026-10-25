/**
 * The whole Phase 1 flow in one test, with real sign-ins for each role:
 * project → upload → facts → gap + conflict → review → snapshot → firm history.
 * Everything is SYNTHETIC.
 */
import { expect, test, type Page } from "@playwright/test";
import { createProject, signIn, upload } from "./helpers";
import { FILE, PDF, addFact, asUser, card } from "./evidence-helpers";

test.afterEach(async ({ page }) => {
  await expect(page.locator("[data-nextjs-fix-card]")).toHaveCount(0);
});

/** True if `wanted` appears in `seen` in the same order (other items may sit between). */
function inOrder(seen: string[], wanted: string[]) {
  let i = 0;
  for (const s of seen) if (i < wanted.length && s.startsWith(wanted[i])) i++;
  return i === wanted.length;
}

async function historyFor(page: Page, query: string) {
  await page.goto(`/history?${query}`);
  return (await page.getByTestId("history-what").allTextContents()).reverse(); // oldest first
}

test("Phase 1 end to end: from project to locked snapshot, fully recorded", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const factA = `SYNTHETIC: Structure is a two-span girder bridge (${stamp}).`;
  const factB1 = `SYNTHETIC: Overall length is 48 m (${stamp}).`;
  const factB2 = `SYNTHETIC: Overall length is 84 m (${stamp}).`;
  const gap = `SYNTHETIC: Year of construction unknown (${stamp})`;
  const conflict = `SYNTHETIC: length values disagree (${stamp})`;

  // 1. Author: project, file, facts, gap, conflict.
  const author = await asUser(browser, "author@example.test");
  const project = await createProject(author.page, { reviewer: "Riley Reviewer (synthetic) (reviewer)" });
  await expect(await upload(author.page, FILE, PDF, "application/pdf")).toHaveText(`Stored: ${FILE}`);
  for (const f of [factA, factB1, factB2]) await addFact(author.page, project.id, f);
  await author.page.getByLabel("What information is missing?").fill(gap);
  await author.page.getByRole("button", { name: "Raise gap" }).click();
  await expect(author.page.getByTestId("gap-card").filter({ hasText: gap })).toBeVisible();
  await author.page.getByLabel("What disagrees?").fill(conflict);
  await author.page.getByLabel(factB1).check();
  await author.page.getByLabel(factB2).check();
  await author.page.getByRole("button", { name: "Raise conflict" }).click();
  await expect(author.page.getByTestId("conflict-card").filter({ hasText: conflict })).toBeVisible();
  await author.close();

  // 2. Reviewer: approve, resolve the conflict, lock a snapshot.
  await signIn(page, "reviewer@example.test");
  await page.goto(`/projects/${project.id}/evidence`);
  for (const f of [factA, factB1, factB2]) {
    await card(page, f).getByRole("button", { name: "Approve" }).click();
    await expect(card(page, f).getByTestId("fact-status")).toHaveText("Approved");
  }
  const cc = page.getByTestId("conflict-card").filter({ hasText: conflict });
  await cc.getByLabel(factB1).check();
  await cc.getByLabel("Resolution note (required)").fill("SYNTHETIC: general arrangement drawing governs");
  await cc.getByRole("button", { name: "Resolve conflict" }).click();
  await expect(cc.getByTestId("conflict-status")).toHaveText("Resolved");

  await page.goto(`/projects/${project.id}/snapshots`);
  await page.getByRole("button", { name: "Lock snapshot 1" }).click();
  const view = page.getByTestId("snapshot-view");
  await expect(view.getByTestId("snapshot-fact")).toHaveCount(2);
  await expect(view.getByTestId("snapshot-facts")).toContainText(factA);
  await expect(view.getByTestId("snapshot-facts")).toContainText(factB1);
  await expect(view.getByTestId("snapshot-gap")).toHaveText(gap);
  await expect(view.getByTestId("snapshot-excluded-fact")).toContainText(factB2);
  await expect(view.getByTestId("snapshot-excluded-fact")).toContainText("Did not prevail");

  // 3. Firm history records every step, in order, without copying content.
  const steps = await historyFor(page, `project=${project.id}`);
  expect(
    inOrder(steps, [
      "Created the project",
      "Started a file upload",
      "Stored a file",
      "Proposed a fact",
      "Proposed a fact",
      "Proposed a fact",
      "Raised a gap",
      "Raised a conflict",
      "Approved a fact",
      "Approved a fact",
      "Approved a fact",
      "Resolved a conflict",
      "Locked an evidence snapshot",
    ]),
  ).toBe(true);
  const allText = await page.getByTestId("history-table").innerText();
  for (const content of [factA, factB1, gap, conflict, FILE]) expect(allText).not.toContain(content);

  // Filters: by type and by person.
  const snaps = await historyFor(page, `project=${project.id}&type=snapshots`);
  expect(snaps).toEqual(["Locked an evidence snapshot · snapshot 1: 2 facts, 1 open gaps, 1 left out"]);
  const reviewerUserOption = page.getByLabel("Person").locator("option", { hasText: "Riley Reviewer (synthetic)" });
  const reviewerId = await reviewerUserOption.getAttribute("value");
  const byReviewer = await historyFor(page, `project=${project.id}&person=${reviewerId}`);
  expect(byReviewer.length).toBeGreaterThan(0);
  expect(byReviewer.every((s) => /^(Approved a fact|Resolved a conflict|Locked an evidence snapshot)/.test(s))).toBe(true);

  // 4. Another firm sees none of it.
  const other = await asUser(browser, "other-admin@example.test");
  await other.page.goto(`/history?project=${project.id}`);
  await expect(other.page.getByText("No matching events.")).toBeVisible();
  await other.page.goto("/history");
  expect(await other.page.locator("main").innerText()).not.toContain(project.name);
  await other.close();
});
