/** Evidence snapshots: preview, lock, immutability, stale locks, permissions. All SYNTHETIC. */
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";
import { addFact, asUser, card, projectWithFile } from "./evidence-helpers";

test.afterEach(async ({ page }) => {
  await expect(page.locator("[data-nextjs-fix-card]")).toHaveCount(0);
});

async function approve(page: Page, projectId: string, statement: string) {
  await page.goto(`/projects/${projectId}/evidence`);
  await card(page, statement).getByRole("button", { name: "Approve" }).click();
  await expect(card(page, statement).getByTestId("fact-status")).toHaveText("Approved");
}

test("reviewer previews and locks a snapshot; it contains exactly the approved evidence and open gaps", async ({ page, browser }) => {
  const projectId = await projectWithFile(browser);
  const stamp = Date.now();
  const approved = `SYNTHETIC: Abutment type is cantilever (${stamp}).`;
  const pending = `SYNTHETIC: Skew is 15 degrees (${stamp}).`;
  const gap = `SYNTHETIC: Scour depth not provided (${stamp})`;

  const author = await asUser(browser, "author@example.test");
  await addFact(author.page, projectId, approved);
  await addFact(author.page, projectId, pending);
  await author.page.getByLabel("What information is missing?").fill(gap);
  await author.page.getByRole("button", { name: "Raise gap" }).click();
  await expect(author.page.getByTestId("gap-card").filter({ hasText: gap })).toBeVisible();
  await author.close();

  await signIn(page, "reviewer@example.test");
  await approve(page, projectId, approved);
  await page.goto(`/projects/${projectId}/snapshots`);
  const preview = page.getByTestId("snapshot-preview");
  await expect(preview.getByTestId("snapshot-fact")).toHaveCount(1);
  await expect(preview.getByTestId("snapshot-fact")).toContainText(approved);
  await expect(preview.getByTestId("snapshot-gap")).toHaveText(gap);
  await expect(preview.getByTestId("pending-note")).toContainText("1 fact is still awaiting review");

  await page.getByLabel("Note (optional)").fill("SYNTHETIC: basis for first draft");
  await page.getByRole("button", { name: "Lock snapshot 1" }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/snapshots/1$`));
  await expect(page.getByTestId("locked-badge")).toBeVisible();
  await expect(page.getByTestId("locked-by")).toHaveText("Riley Reviewer (synthetic)");
  await expect(page.getByTestId("snapshot-fact")).toContainText(approved);
  await expect(page.getByTestId("snapshot-fact")).not.toContainText(pending);
  await expect(page.getByTestId("snapshot-gap")).toHaveText(gap);
});

test("editing evidence after locking never changes the locked snapshot", async ({ page, browser }) => {
  const projectId = await projectWithFile(browser);
  const statement = `SYNTHETIC: Design speed is 50 km/h (${Date.now()}).`;
  const author = await asUser(browser, "author@example.test");
  await addFact(author.page, projectId, statement);

  await signIn(page, "reviewer@example.test");
  await approve(page, projectId, statement);
  await page.goto(`/projects/${projectId}/snapshots`);
  await page.getByRole("button", { name: "Lock snapshot 1" }).click();
  await expect(page.getByTestId("locked-badge")).toBeVisible();

  // Author edits the approved fact afterwards.
  await author.page.goto(`/projects/${projectId}/evidence`);
  const c = card(author.page, statement);
  await c.getByText("Edit (creates a new revision that needs review)").click();
  await c.getByLabel("Fact (one clear statement)").fill(`${statement} CHANGED`);
  await c.getByRole("button", { name: "Save as new revision" }).click();
  await expect(card(author.page, `${statement} CHANGED`)).toBeVisible();
  await author.close();

  await page.goto(`/projects/${projectId}/snapshots/1`);
  await expect(page.getByTestId("snapshot-fact")).toHaveText(new RegExp(statement.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  await expect(page.getByTestId("snapshot-fact")).not.toContainText("CHANGED");

  // The edited fact is awaiting review, so the next snapshot has nothing approved yet.
  await page.goto(`/projects/${projectId}/snapshots`);
  await expect(page.getByText("Approve at least one fact before locking a snapshot.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Lock snapshot/ })).toHaveCount(0);
});

test("a lock is refused if evidence changed after the preview was opened", async ({ page, browser }) => {
  const projectId = await projectWithFile(browser);
  const stamp = Date.now();
  const first = `SYNTHETIC: Pile length 18 m (${stamp}).`;
  const second = `SYNTHETIC: Pile diameter 600 mm (${stamp}).`;
  const author = await asUser(browser, "author@example.test");
  await addFact(author.page, projectId, first);
  await addFact(author.page, projectId, second);
  await author.close();

  await signIn(page, "reviewer@example.test");
  await approve(page, projectId, first);
  await page.goto(`/projects/${projectId}/snapshots`); // preview opened…

  const admin = await asUser(browser, "admin@example.test");
  await approve(admin.page, projectId, second); // …evidence changes meanwhile
  await admin.close();

  await page.getByRole("button", { name: "Lock snapshot 1" }).click();
  await expect(page.getByTestId("lock-error")).toContainText("The evidence changed after you opened this page. Nothing was locked.");
  await page.reload();
  await expect(page.getByTestId("snapshot-preview").getByTestId("snapshot-fact")).toHaveCount(2);
});

test("facts in an open conflict are listed as left out, with the reason", async ({ page, browser }) => {
  const projectId = await projectWithFile(browser);
  const stamp = Date.now();
  const a = `SYNTHETIC: Span 24 m (${stamp}).`;
  const b = `SYNTHETIC: Span 42 m (${stamp}).`;
  const author = await asUser(browser, "author@example.test");
  await addFact(author.page, projectId, a);
  await addFact(author.page, projectId, b);
  await author.page.getByLabel("What disagrees?").fill(`SYNTHETIC: span disagreement (${stamp})`);
  await author.page.getByLabel(a).check();
  await author.page.getByLabel(b).check();
  await author.page.getByRole("button", { name: "Raise conflict" }).click();
  await expect(author.page.getByTestId("conflict-card")).toBeVisible();
  await author.close();

  await signIn(page, "reviewer@example.test");
  await approve(page, projectId, a);
  await approve(page, projectId, b);
  await page.goto(`/projects/${projectId}/snapshots`);
  const preview = page.getByTestId("snapshot-preview");
  await expect(preview.getByTestId("snapshot-fact")).toHaveCount(0);
  await expect(preview.getByTestId("snapshot-excluded-fact")).toHaveCount(2);
  await expect(preview.getByTestId("snapshot-excluded-fact").first()).toContainText("In an open conflict");
});

test("authors and viewers can see snapshots but cannot lock them; nothing new means nothing to lock", async ({ page, browser }) => {
  const projectId = await projectWithFile(browser);
  const statement = `SYNTHETIC: Deck is composite (${Date.now()}).`;
  const author = await asUser(browser, "author@example.test");
  await addFact(author.page, projectId, statement);
  const reviewer = await asUser(browser, "reviewer@example.test");
  await approve(reviewer.page, projectId, statement);

  await author.page.goto(`/projects/${projectId}/snapshots`);
  await expect(author.page.getByText("Only reviewers and admins can lock snapshots.")).toBeVisible();
  await expect(author.page.getByRole("button", { name: /Lock snapshot/ })).toHaveCount(0);
  await author.close();

  await reviewer.page.goto(`/projects/${projectId}/snapshots`);
  await reviewer.page.getByRole("button", { name: "Lock snapshot 1" }).click();
  await expect(reviewer.page.getByTestId("locked-badge")).toBeVisible();
  await reviewer.page.goto(`/projects/${projectId}/snapshots`);
  await expect(reviewer.page.getByTestId("unchanged-note")).toContainText("Nothing has changed since snapshot 1");
  await expect(reviewer.page.getByRole("button", { name: /Lock snapshot/ })).toHaveCount(0);
  await reviewer.close();

  await signIn(page, "viewer@example.test");
  await page.goto(`/projects/${projectId}/snapshots/1`);
  await expect(page.getByTestId("snapshot-fact")).toContainText(statement);
  await expect(page.getByRole("button", { name: /Lock snapshot/ })).toHaveCount(0);
});
