/**
 * Upload / download flow against real local Supabase Storage.
 * Every file here is a SYNTHETIC byte sequence built in memory — no real documents.
 */
import { expect, test, type Page } from "@playwright/test";
import { createProject, signIn } from "./helpers";

test.afterEach(async ({ page }) => {
  await expect(page.locator("[data-nextjs-fix-card]")).toHaveCount(0);
});

const PDF = Buffer.from("%PDF-1.4\n% SYNTHETIC test file - not a real document\n%%EOF\n");
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("SYNTHETIC")]);
const TXT = Buffer.from("SYNTHETIC field note: pier 3 bearing inspected, no defects observed.\n");
const EXE = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);

async function upload(page: Page, name: string, buffer: Buffer, mimeType: string, asVersionOf?: string) {
  await page.getByLabel("File", { exact: true }).setInputFiles({ name, mimeType, buffer });
  if (asVersionOf) await page.getByLabel("Upload as", { exact: true }).selectOption({ label: `New version of: ${asVersionOf}` });
  await page.getByRole("button", { name: "Upload" }).click();
  const status = page.getByTestId("upload-status");
  await expect(status).toHaveText(/^(Stored|Blocked|The |Your |This |Choose)/, { timeout: 30_000 });
  return status;
}

test("author uploads PDF, PNG and text; they are stored, not scanned, and downloadable", async ({ page }) => {
  await signIn(page, "author@example.test");
  const p = await createProject(page);

  await expect(await upload(page, "SYNTHETIC-survey.pdf", PDF, "application/pdf")).toHaveText("Stored: SYNTHETIC-survey.pdf");
  await expect(await upload(page, "SYNTHETIC-map.png", PNG, "image/png")).toHaveText("Stored: SYNTHETIC-map.png");
  await expect(await upload(page, "SYNTHETIC-notes.txt", TXT, "text/plain")).toHaveText("Stored: SYNTHETIC-notes.txt");

  const rows = page.getByTestId("source-version");
  await expect(rows).toHaveCount(3);
  for (const r of await rows.all()) {
    await expect(r.getByTestId("version-status")).toHaveText("Stored");
    await expect(r).toContainText("Not scanned");
  }

  // Download goes through the app's permission check, then a short-lived signed URL.
  const pdfRow = rows.filter({ hasText: "SYNTHETIC-survey.pdf" });
  const href = await pdfRow.getByTestId("download").getAttribute("href");
  const res = await page.request.get(href!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-disposition"] ?? "").toContain("attachment");
  expect(Buffer.from(await res.body()).equals(PDF)).toBe(true);
  expect(res.url()).toContain("token="); // served via signed URL, not a public link

  await expect(page.getByTestId("project-history")).toBeVisible();
  expect(p.id).toBeTruthy();
});

test("uploading a new version keeps the earlier version", async ({ page }) => {
  await signIn(page, "author@example.test");
  await createProject(page);
  await upload(page, "SYNTHETIC-report.pdf", PDF, "application/pdf");
  const v2 = Buffer.concat([PDF, Buffer.from("% revision 2\n")]);
  await expect(await upload(page, "SYNTHETIC-report-rev2.pdf", v2, "application/pdf", "SYNTHETIC-report.pdf")).toHaveText(
    "Stored: SYNTHETIC-report-rev2.pdf",
  );
  const source = page.getByTestId("source").filter({ hasText: "SYNTHETIC-report.pdf" });
  await expect(source.getByTestId("source-version")).toHaveCount(2);
  await expect(source.getByTestId("source-version").first()).toContainText("v2");
  await expect(source.getByTestId("source-version").last()).toContainText("v1");
});

test("a disguised file is blocked after upload and can't be downloaded", async ({ page }) => {
  await signIn(page, "author@example.test");
  await createProject(page);
  const status = await upload(page, "SYNTHETIC-invoice.pdf", EXE, "application/pdf");
  await expect(status).toHaveText("Blocked: File contents don't match its extension.");
  const row = page.getByTestId("source-version");
  await expect(row.getByTestId("version-status")).toHaveText("Blocked: File contents don't match its extension");
  await expect(row.getByTestId("download")).toHaveCount(0);
});

test("unsupported types are recorded as blocked without uploading", async ({ page }) => {
  await signIn(page, "author@example.test");
  await createProject(page);
  const docx = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
  const status = await upload(page, "SYNTHETIC-spec.docx", docx, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  await expect(status).toContainText("Export to PDF");
  await expect(page.getByTestId("version-status")).toHaveText("Blocked: Unsupported file type");

  const dwg = Buffer.from("AC1032SYNTHETIC");
  await expect(await upload(page, "SYNTHETIC-site.dwg", dwg, "application/octet-stream")).toContainText("CAD, BIM and GIS");
});

test("viewer can download but not upload; another firm can do neither", async ({ page, browser }) => {
  const authorCtx = await browser.newContext();
  const author = await authorCtx.newPage();
  await signIn(author, "author@example.test");
  const p = await createProject(author);
  await upload(author, "SYNTHETIC-shared.pdf", PDF, "application/pdf");
  const href = await author.getByTestId("download").getAttribute("href");
  await authorCtx.close();

  await signIn(page, "viewer@example.test");
  await page.goto(`/projects/${p.id}`);
  await expect(page.getByRole("button", { name: "Upload" })).toHaveCount(0);
  const viewerRes = await page.request.get(href!);
  expect(viewerRes.status()).toBe(200);

  const otherCtx = await browser.newContext();
  const other = await otherCtx.newPage();
  await signIn(other, "other-admin@example.test");
  const otherRes = await other.request.get(href!, { maxRedirects: 0 });
  expect(otherRes.status()).toBe(404);
  await otherCtx.close();

  const anonCtx = await browser.newContext();
  const anonRes = await anonCtx.request.get(`http://localhost:3000${href}`, { maxRedirects: 0 });
  expect([307, 401]).toContain(anonRes.status());
  await anonCtx.close();
});
