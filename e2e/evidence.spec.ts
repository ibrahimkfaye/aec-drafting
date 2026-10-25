/**
 * Evidence review: candidate facts, separation of duties, rejection, stale approval,
 * edits after approval. All facts, excerpts and files are SYNTHETIC.
 */
import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";
import { FILE, addFact, addSection, asUser, card, projectWithFile } from "./evidence-helpers";

test.afterEach(async ({ page }) => {
  await expect(page.locator("[data-nextjs-fix-card]")).toHaveCount(0);
});

test("author proposes, reviewer approves; author cannot approve", async ({ page, browser }) => {
  const projectId = await projectWithFile(browser);
  await signIn(page, "author@example.test");
  await page.goto(`/projects/${projectId}/evidence`);

  // Required fields are enforced on the server.
  await addSection(page).getByRole("button", { name: "Add candidate fact" }).click();
  await expect(addSection(page).getByText("Write the fact as one clear statement.")).toBeVisible();
  await expect(addSection(page).getByText("Choose the source file this comes from.")).toBeVisible();

  const statement = `SYNTHETIC: Pier 3 bearing is elastomeric (${Date.now()}).`;
  await addFact(page, projectId, statement);
  const c = card(page, statement);
  await expect(c.getByTestId("fact-status")).toHaveText("Needs review");
  await expect(c.getByTestId("fact-citation")).toHaveText(`${FILE} · v1 · p. 4`);
  await expect(c.getByRole("button", { name: "Approve" })).toHaveCount(0);

  const reviewer = await asUser(browser, "reviewer@example.test");
  await reviewer.page.goto(`/projects/${projectId}/evidence`);
  await card(reviewer.page, statement).getByRole("button", { name: "Approve" }).click();
  const approved = reviewer.page.getByTestId("group-Approved");
  await expect(card(reviewer.page, statement).getByTestId("fact-status")).toHaveText("Approved");
  await expect(approved).toContainText(statement);
  await expect(approved).toContainText("Approved by Riley Reviewer (synthetic)");
  await reviewer.close();
});

test("a reviewer cannot approve their own fact; an admin can and is flagged", async ({ page, browser }) => {
  const projectId = await projectWithFile(browser);
  const reviewerFact = `SYNTHETIC: Deck width is 9.1 m (${Date.now()}).`;
  const reviewer = await asUser(browser, "reviewer@example.test");
  await addFact(reviewer.page, projectId, reviewerFact);
  const own = card(reviewer.page, reviewerFact);
  await expect(own.getByTestId("own-fact-note")).toBeVisible();
  await expect(own.getByRole("button", { name: "Approve" })).toHaveCount(0);
  await reviewer.close();

  await signIn(page, "admin@example.test");
  const adminFact = `SYNTHETIC: Design year is 2031 (${Date.now()}).`;
  await addFact(page, projectId, adminFact);
  await card(page, adminFact).getByRole("button", { name: "Approve" }).click();
  await expect(card(page, adminFact).getByTestId("self-approved")).toHaveText("Self-approved by admin");

  // The admin can also approve the reviewer's fact (different author, no flag).
  await card(page, reviewerFact).getByRole("button", { name: "Approve" }).click();
  await expect(card(page, reviewerFact).getByTestId("fact-status")).toHaveText("Approved");
  await expect(card(page, reviewerFact).getByTestId("self-approved")).toHaveCount(0);
});

test("rejection requires a note, which is shown with the fact", async ({ page, browser }) => {
  const projectId = await projectWithFile(browser);
  const statement = `SYNTHETIC: Span is 42 m (${Date.now()}).`;
  const author = await asUser(browser, "author@example.test");
  await addFact(author.page, projectId, statement);
  await author.close();

  await signIn(page, "reviewer@example.test");
  await page.goto(`/projects/${projectId}/evidence`);
  await card(page, statement).getByRole("button", { name: "Reject" }).click();
  await expect(card(page, statement).getByTestId("review-error")).toHaveText("Explain why you are rejecting this fact.");
  await expect(card(page, statement).getByLabel("Review note (required to reject)")).toHaveValue("");
  await card(page, statement).getByLabel("Review note (required to reject)").fill("SYNTHETIC: excerpt says 24 m, not 42 m");
  await card(page, statement).getByRole("button", { name: "Reject" }).click();
  const rejected = page.getByTestId("group-Rejected");
  await expect(rejected).toContainText(statement);
  await expect(rejected).toContainText("Review note: SYNTHETIC: excerpt says 24 m, not 42 m");
});

test("an approval made on an outdated page is refused", async ({ page, browser }) => {
  const projectId = await projectWithFile(browser);
  const statement = `SYNTHETIC: Clearance is 5.2 m (${Date.now()}).`;
  const author = await asUser(browser, "author@example.test");
  await addFact(author.page, projectId, statement);

  // Reviewer opens the page and sees revision 1 …
  await signIn(page, "reviewer@example.test");
  await page.goto(`/projects/${projectId}/evidence`);
  await expect(card(page, statement)).toBeVisible();

  // … meanwhile the author edits the fact (revision 2).
  const authorCard = card(author.page, statement);
  await authorCard.getByText("Edit (creates a new revision that needs review)").click();
  await authorCard.getByLabel("Fact (one clear statement)").fill(`${statement} Revised.`);
  await authorCard.getByRole("button", { name: "Save as new revision" }).click();
  await expect(card(author.page, `${statement} Revised.`)).toBeVisible();
  await author.close();

  // The reviewer's approval of revision 1 must not count for revision 2.
  await card(page, statement).getByRole("button", { name: "Approve" }).click();
  await expect(card(page, statement).getByTestId("review-error")).toContainText("changed after you opened it");
  await page.reload();
  await expect(card(page, `${statement} Revised.`).getByTestId("fact-status")).toHaveText("Needs review");
});

test("editing an approved fact sends it back for review and keeps the history", async ({ page, browser }) => {
  const projectId = await projectWithFile(browser);
  const statement = `SYNTHETIC: Foundation is spread footing (${Date.now()}).`;
  await signIn(page, "author@example.test");
  await addFact(page, projectId, statement);

  const reviewer = await asUser(browser, "reviewer@example.test");
  await reviewer.page.goto(`/projects/${projectId}/evidence`);
  await card(reviewer.page, statement).getByRole("button", { name: "Approve" }).click();
  await expect(card(reviewer.page, statement).getByTestId("fact-status")).toHaveText("Approved");
  await reviewer.close();

  await page.reload();
  const c = card(page, statement);
  await c.getByText("Edit (creates a new revision that needs review)").click();
  await c.getByLabel("Fact (one clear statement)").fill(`${statement} On rock.`);
  await c.getByRole("button", { name: "Save as new revision" }).click();

  const edited = card(page, `${statement} On rock.`);
  await expect(page.getByTestId("group-Needs review")).toContainText(`${statement} On rock.`);
  await expect(edited.getByTestId("fact-status")).toHaveText("Needs review");
  await edited.getByText("Earlier revisions (1)").click();
  await expect(edited.getByTestId("earlier-status")).toHaveText("Superseded");
  await expect(edited).toContainText("Approved by Riley Reviewer (synthetic)");
});

test("viewers can read evidence but cannot add, edit or review", async ({ page, browser }) => {
  const projectId = await projectWithFile(browser);
  const statement = `SYNTHETIC: Lane count is 2 (${Date.now()}).`;
  const author = await asUser(browser, "author@example.test");
  await addFact(author.page, projectId, statement);
  await author.close();

  await signIn(page, "viewer@example.test");
  await page.goto(`/projects/${projectId}/evidence`);
  await expect(card(page, statement)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Add a fact" })).toHaveCount(0);
  await expect(card(page, statement).getByRole("button", { name: "Approve" })).toHaveCount(0);
  await expect(card(page, statement).getByText("Edit (creates a new revision that needs review)")).toHaveCount(0);
});
