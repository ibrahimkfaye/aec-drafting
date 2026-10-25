/**
 * Text extraction (2.1): page text from SYNTHETIC in-memory PDFs, "needs OCR" for
 * scans and images, the excerpt picker, and the excerpt check on fact cards.
 */
import { expect, test, type Page } from "@playwright/test";
import { createProject, signIn, upload } from "./helpers";
import { addSection, card } from "./evidence-helpers";
import { makePdf } from "../tests/unit/fixtures/make-pdf";

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
