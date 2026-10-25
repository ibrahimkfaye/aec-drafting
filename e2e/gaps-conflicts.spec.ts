/** Gaps (missing information) and conflicts. All content is SYNTHETIC. */
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";
import { addFact, asUser, card, projectWithFile } from "./evidence-helpers";

test.afterEach(async ({ page }) => {
  await expect(page.locator("[data-nextjs-fix-card]")).toHaveCount(0);
});

const gapCard = (page: Page, text: string) => page.getByTestId("gap-card").filter({ hasText: text });
const conflictCard = (page: Page, text: string) => page.getByTestId("conflict-card").filter({ hasText: text });

async function raiseGap(page: Page, projectId: string, text: string) {
  await page.goto(`/projects/${projectId}/evidence`);
  await page.getByLabel("What information is missing?").fill(text);
  await page.getByRole("button", { name: "Raise gap" }).click();
  await expect(gapCard(page, text).getByTestId("gap-status")).toHaveText("Open");
}

test("a gap is resolved by a reviewer with an approved fact", async ({ page, browser }) => {
  const projectId = await projectWithFile(browser);
  const gap = `SYNTHETIC: Bearing capacity for Pier 3 not provided (${Date.now()})`;
  const fact = `SYNTHETIC: Allowable bearing is 300 kPa (${Date.now()}).`;

  const author = await asUser(browser, "author@example.test");
  await raiseGap(author.page, projectId, gap);
  await addFact(author.page, projectId, fact);
  await author.close();

  await signIn(page, "reviewer@example.test");
  await page.goto(`/projects/${projectId}/evidence`);
  // The fact is only a candidate, so it is not offered yet.
  await expect(gapCard(page, gap).getByLabel("Approved fact that fills this gap").locator("option")).toHaveCount(1);
  await gapCard(page, gap).getByRole("button", { name: "Resolve with fact" }).click();
  await expect(gapCard(page, gap).getByTestId("gap-close-error")).toHaveText("Choose the approved fact that fills this gap.");

  await card(page, fact).getByRole("button", { name: "Approve" }).click();
  await expect(card(page, fact).getByTestId("fact-status")).toHaveText("Approved");
  await gapCard(page, gap).getByLabel("Approved fact that fills this gap").selectOption({ label: fact });
  await gapCard(page, gap).getByRole("button", { name: "Resolve with fact" }).click();
  await expect(gapCard(page, gap).getByTestId("gap-status")).toHaveText("Resolved");
  await expect(gapCard(page, gap).getByTestId("gap-resolution")).toHaveText(`Filled by: ${fact}`);
});

test("dismissing a gap needs a reason; the raiser cannot close their own gap", async ({ page, browser }) => {
  const projectId = await projectWithFile(browser);
  const gap = `SYNTHETIC: Traffic count missing (${Date.now()})`;
  await signIn(page, "reviewer@example.test");
  await raiseGap(page, projectId, gap);
  await expect(gapCard(page, gap)).toContainText("You raised this gap, so another reviewer must close it.");
  await expect(gapCard(page, gap).getByRole("button", { name: "Dismiss" })).toHaveCount(0);

  const admin = await asUser(browser, "admin@example.test");
  await admin.page.goto(`/projects/${projectId}/evidence`);
  const c = gapCard(admin.page, gap);
  await c.getByRole("button", { name: "Dismiss" }).click();
  await expect(c.getByTestId("gap-close-error")).toHaveText("Explain why you are dismissing this gap.");
  await c.getByLabel("Note (required to dismiss)").fill("SYNTHETIC: not required for this memo type");
  await c.getByRole("button", { name: "Dismiss" }).click();
  await expect(c.getByTestId("gap-status")).toHaveText("Dismissed");
  await expect(c).toContainText("Note: SYNTHETIC: not required for this memo type");
  await admin.close();
});

test("a conflict flags its facts until a reviewer picks the one that stands", async ({ page, browser }) => {
  const projectId = await projectWithFile(browser);
  const stamp = Date.now();
  const a = `SYNTHETIC: Span is 24 m (${stamp}).`;
  const b = `SYNTHETIC: Span is 42 m (${stamp}).`;
  const description = `SYNTHETIC: span values disagree (${stamp})`;

  const author = await asUser(browser, "author@example.test");
  await addFact(author.page, projectId, a);
  await addFact(author.page, projectId, b);
  // Fewer than two facts is refused.
  await author.page.getByLabel("What disagrees?").fill(description);
  await author.page.getByLabel(a).check();
  await author.page.getByRole("button", { name: "Raise conflict" }).click();
  await expect(author.page.getByTestId("conflict-form-error")).toHaveText("Choose at least two different facts.");
  // What was typed and ticked is kept after a refused submit.
  await expect(author.page.getByLabel("What disagrees?")).toHaveValue(description);
  await expect(author.page.getByLabel(a)).toBeChecked();
  await author.page.getByLabel(b).check();
  await author.page.getByRole("button", { name: "Raise conflict" }).click();
  await expect(conflictCard(author.page, description).getByTestId("conflict-status")).toHaveText("Open");
  await expect(card(author.page, a).getByTestId("conflict-flag")).toContainText("In an open conflict");
  await author.close();

  await signIn(page, "reviewer@example.test");
  await page.goto(`/projects/${projectId}/evidence`);
  const cc = conflictCard(page, description);
  await cc.getByRole("button", { name: "Resolve conflict" }).click();
  await expect(cc.getByTestId("conflict-resolve-error")).toHaveText("Choose which fact stands.");
  await cc.getByLabel(a).check();
  await cc.getByRole("button", { name: "Resolve conflict" }).click();
  await expect(cc.getByTestId("conflict-resolve-error")).toHaveText("Explain how the conflict was resolved.");
  await expect(cc.getByLabel(a)).toBeChecked();
  await cc.getByLabel("Resolution note (required)").fill("SYNTHETIC: drawing S-101 governs");
  await cc.getByRole("button", { name: "Resolve conflict" }).click();

  await expect(cc.getByTestId("conflict-status")).toHaveText("Resolved");
  await expect(cc.getByTestId("prevailing-fact")).toContainText(a);
  await expect(card(page, a).getByTestId("conflict-flag")).toHaveCount(0);
  await expect(card(page, b).getByTestId("conflict-flag")).toContainText("Did not prevail");
});

test("viewers see gaps and conflicts but cannot raise or close them", async ({ page, browser }) => {
  const projectId = await projectWithFile(browser);
  const gap = `SYNTHETIC: Survey date unknown (${Date.now()})`;
  const author = await asUser(browser, "author@example.test");
  await raiseGap(author.page, projectId, gap);
  await author.close();

  await signIn(page, "viewer@example.test");
  await page.goto(`/projects/${projectId}/evidence`);
  await expect(gapCard(page, gap)).toBeVisible();
  await expect(page.getByRole("button", { name: "Raise gap" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Dismiss" })).toHaveCount(0);
});
