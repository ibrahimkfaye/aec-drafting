/**
 * Text extraction (2.1): page text from SYNTHETIC in-memory PDFs, "needs OCR" for
 * scans and images, the excerpt picker, and the excerpt check on fact cards.
 */
import { expect, test, type Page } from "@playwright/test";
import { createProject, signIn, upload } from "./helpers";
import { addSection, card } from "./evidence-helpers";
import { makePdf } from "../tests/unit/fixtures/make-pdf";
import { makeScanImage, makeScanPdf } from "../tests/unit/fixtures/make-scan";

test.afterEach(async ({ page }) => {
  await expect(page.locator("[data-nextjs-fix-card]")).toHaveCount(0);
});

const REPORT = Buffer.from(
  makePdf(["SYNTHETIC inspection report\nThe overall span is 24 m between bearings.\nDeck width 9.1 m.", ""]),
);
const SCAN = Buffer.from(makePdf(["", ""]));
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("SYNTHETIC")]);

/** Background extraction runs after verification; reload until the file's text status settles. */
async function textStatusOf(page: Page, filename: string) {
  const row = page.getByTestId("source-version").filter({ hasText: filename });
  await expect(async () => {
    await page.reload();
    await expect(row.getByTestId("text-status")).not.toHaveText("Extracting…", { timeout: 1000 });
    await expect(row.getByTestId("text-status")).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  return row.getByTestId("text-status");
}

/** Selects `snippet` inside the excerpt picker's text panel, like a mouse drag would. */
async function selectInPicker(page: Page, snippet: string) {
  await page.getByTestId("picker-text").evaluate((pre, s) => {
    const node = pre.firstChild as Text;
    const start = node.data.indexOf(s);
    if (start < 0) throw new Error("snippet not in page text");
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + s.length);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  }, snippet);
}

test("a text-based PDF is extracted page by page and readable in the page viewer", async ({ page }) => {
  await signIn(page, "author@example.test");
  await createProject(page);
  await expect(await upload(page, "SYNTHETIC-report.pdf", REPORT, "application/pdf")).toHaveText("Stored: SYNTHETIC-report.pdf");
  const status = await textStatusOf(page, "SYNTHETIC-report.pdf");
  await expect(status).toHaveText("Text: 1 of 2 pages");

  await status.click();
  await expect(page.getByTestId("page-number")).toHaveText("1");
  await expect(page.getByTestId("page-text")).toContainText("The overall span is 24 m between bearings.");
  await expect(page.getByText("Derived text. The original file is the authority")).toBeVisible();
  await page.getByRole("link", { name: "Next page →" }).click();
  await expect(page.getByTestId("page-text-empty")).toBeVisible();
});

test("scanned PDFs and images are marked as needing OCR, not guessed", async ({ page }) => {
  await signIn(page, "author@example.test");
  await createProject(page);
  await upload(page, "SYNTHETIC-scan.pdf", SCAN, "application/pdf");
  await expect(await textStatusOf(page, "SYNTHETIC-scan.pdf")).toHaveText("Needs OCR (no text layer)");
  await upload(page, "SYNTHETIC-photo.png", PNG, "image/png");
  await expect(await textStatusOf(page, "SYNTHETIC-photo.png")).toHaveText("Needs OCR (no text layer)");
});

test("the excerpt picker fills the excerpt from page text, and cards show whether excerpts match", async ({ page }) => {
  await signIn(page, "author@example.test");
  const p = await createProject(page);
  await upload(page, "SYNTHETIC-report.pdf", REPORT, "application/pdf");
  await textStatusOf(page, "SYNTHETIC-report.pdf");

  await page.goto(`/projects/${p.id}/evidence`);
  const form = addSection(page);
  const picked = `SYNTHETIC: Span is 24 m (${Date.now()}).`;
  await form.getByLabel("Fact (one clear statement)").fill(picked);
  await form.getByLabel("Source file").selectOption({ label: "SYNTHETIC-report.pdf (v1)" });
  await form.getByLabel("Page", { exact: true }).fill("1");
  await form.getByTestId("show-page-text").click();
  await expect(form.getByTestId("picker-text")).toContainText("overall span is 24 m");
  await selectInPicker(page, "The overall span is 24 m between bearings.");
  await form.getByRole("button", { name: "Use selected text as excerpt" }).click();
  await expect(form.getByLabel("Supporting excerpt (copied from the source)")).toHaveValue("The overall span is 24 m between bearings.");
  await form.getByRole("button", { name: "Add candidate fact" }).click();
  await expect(card(page, picked).getByTestId("excerpt-match")).toHaveText("✓ Excerpt found in the extracted text of page 1");

  // A typed excerpt that does not appear on the page is flagged for the reviewer.
  const typed = `SYNTHETIC: Span is 42 m (${Date.now()}).`;
  await form.getByLabel("Fact (one clear statement)").fill(typed);
  await form.getByLabel("Source file").selectOption({ label: "SYNTHETIC-report.pdf (v1)" });
  await form.getByLabel("Page", { exact: true }).fill("1");
  await form.getByLabel("Supporting excerpt (copied from the source)").fill("The overall span is 42 m between bearings.");
  await form.getByRole("button", { name: "Add candidate fact" }).click();
  await expect(card(page, typed).getByTestId("excerpt-match")).toContainText("⚠ Excerpt not found in the extracted text of page 1");

  // Asking for a page with no text explains what to do instead.
  await form.getByLabel("Source file").selectOption({ label: "SYNTHETIC-report.pdf (v1)" });
  await form.getByLabel("Page", { exact: true }).fill("2");
  await form.getByTestId("show-page-text").click();
  await expect(form.getByTestId("page-text-message")).toContainText("no extracted text");
});

const SCANNED = Buffer.from(makeScanPdf([makeScanImage(["SYNTHETIC scanned field notes", "Deck width is 9.1 m at midspan."], "jpeg"), null]));

test("a scanned PDF can be OCR'd locally; OCR text is labelled everywhere it appears", async ({ page, browser }) => {
  test.setTimeout(150_000); // OCR takes seconds per page
  await signIn(page, "author@example.test");
  const p = await createProject(page);
  await upload(page, "SYNTHETIC-scanned.pdf", SCANNED, "application/pdf");
  const status = await textStatusOf(page, "SYNTHETIC-scanned.pdf");
  await expect(status).toHaveText("Needs OCR (no text layer)");

  const row = page.getByTestId("source-version").filter({ hasText: "SYNTHETIC-scanned.pdf" });
  await row.getByTestId("run-ocr").click();
  await expect(async () => {
    await page.reload();
    await expect(row.getByTestId("text-status")).toHaveText("OCR text: 1 of 2 pages", { timeout: 1000 });
  }).toPass({ timeout: 90_000 });
  await expect(row.getByTestId("ocr-confidence")).toContainText("OCR — may contain errors");

  await row.getByTestId("text-status").click();
  await expect(page.getByTestId("page-text")).toContainText("Deck width is 9.1 m at midspan.");
  await expect(page.getByTestId("ocr-warning")).toContainText("may misread characters");

  await page.goto(`/projects/${p.id}/evidence`);
  const form = addSection(page);
  const statement = `SYNTHETIC: Deck width 9.1 m (${Date.now()}).`;
  await form.getByLabel("Fact (one clear statement)").fill(statement);
  await form.getByLabel("Source file").selectOption({ label: "SYNTHETIC-scanned.pdf (v1)" });
  await form.getByLabel("Page", { exact: true }).fill("1");
  await form.getByTestId("show-page-text").click();
  await expect(form.getByTestId("picker-ocr-warning")).toBeVisible();
  await selectInPicker(page, "Deck width is 9.1 m at midspan.");
  await form.getByRole("button", { name: "Use selected text as excerpt" }).click();
  await form.getByRole("button", { name: "Add candidate fact" }).click();
  await expect(card(page, statement).getByTestId("excerpt-match")).toContainText("✓ Excerpt found in the OCR text of page 1");

  // Reviewers see the OCR text but cannot start OCR.
  const ctx = await browser.newContext();
  const reviewer = await ctx.newPage();
  await signIn(reviewer, "reviewer@example.test");
  await reviewer.goto(`/projects/${p.id}`);
  await expect(reviewer.getByTestId("run-ocr")).toHaveCount(0);
  await ctx.close();
});

test("an image with no text gets 'OCR found no text', not invented text", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, "author@example.test");
  await createProject(page);
  const blank = Buffer.from(makeScanImage([], "png", 800, 600));
  await upload(page, "SYNTHETIC-blank.png", blank, "image/png");
  await expect(await textStatusOf(page, "SYNTHETIC-blank.png")).toHaveText("Needs OCR (no text layer)");
  const row = page.getByTestId("source-version").filter({ hasText: "SYNTHETIC-blank.png" });
  await row.getByTestId("run-ocr").click();
  await expect(async () => {
    await page.reload();
    await expect(row.getByTestId("text-status")).toHaveText("OCR found no text", { timeout: 1000 });
  }).toPass({ timeout: 60_000 });
});
