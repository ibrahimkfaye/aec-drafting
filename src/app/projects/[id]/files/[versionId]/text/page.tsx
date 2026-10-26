import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { requireMembership } from "@/lib/auth";
import { getProject } from "@/lib/projects";
import { getVersion } from "@/lib/sources";
import { createClient } from "@/lib/supabase/server";
import { PageShell } from "@/app/page-shell";

type Props = { params: Promise<{ id: string; versionId: string }>; searchParams: Promise<{ page?: string }> };

export default function TextPage(props: Props) {
  return (
    <Suspense fallback={<PageShell>Loading…</PageShell>}>
      <TextView {...props} />
    </Suspense>
  );
}

async function TextView({ params, searchParams }: Props) {
  const { id, versionId } = await params;
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(versionId).success) notFound();
  const m = await requireMembership();
  const [project, version] = await Promise.all([getProject(m.orgId, id), getVersion(m.orgId, id, versionId)]);
  if (!project || !version) notFound();

  const supabase = await createClient();
  const { data: ex } = await supabase
    .from("source_text_extractions")
    .select("status, page_count, pages_with_text, method, extractor, created_at")
    .eq("source_version_id", versionId)
    .maybeSingle();
  if (!ex) notFound();
  // Files with no text layer may have OCR text instead.
  const { data: ocr } =
    ex.status === "needs_ocr"
      ? await supabase
          .from("source_ocr_results")
          .select("status, page_count, engine, render_dpi, mean_confidence")
          .eq("source_version_id", versionId)
          .maybeSingle()
      : { data: null };
  if (ex.status !== "extracted" && ocr?.status !== "recognized") notFound();
  const pageCount = ocr ? ocr.page_count : ex.page_count;

  const n = z.coerce.number().int().min(1).max(pageCount).catch(1).parse((await searchParams).page ?? "1");
  const { data: page } = await supabase
    .from("source_pages")
    .select("page_number, text, origin, ocr_confidence")
    .eq("source_version_id", versionId)
    .eq("page_number", n)
    .maybeSingle();
  const base = `/projects/${id}/files/${versionId}/text`;

  return (
    <PageShell back={{ href: `/projects/${id}`, label: project.name }}>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold break-all">{version.original_filename}</h1>
        <p className="text-sm text-zinc-600">
          v{version.version_number} · extracted text, page <span data-testid="page-number">{n}</span> of {pageCount} ·{" "}
          {ocr
            ? `recognized by OCR · ${ocr.engine}${ocr.render_dpi ? ` · rendered at ${ocr.render_dpi} DPI` : ""}`
            : `${ex.method === "pdf_text_layer" ? "from the PDF's text layer" : "plain text"} · ${ex.extractor}`}
        </p>
        <p className="w-fit rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-900">
          Derived text. The original file is the authority — check it before relying on this text.
        </p>
        {ocr && (
          <p className="w-fit rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900" data-testid="ocr-warning">
            OCR text: the engine may misread characters, especially numbers, units and symbols.
            {page?.ocr_confidence != null && ` Engine confidence for this page: ${Math.round(Number(page.ocr_confidence))}% (an estimate, not a measure of accuracy).`}
          </p>
        )}
      </header>
      <nav className="flex items-center gap-3 text-sm" aria-label="Pages">
        {n > 1 ? <Link className="underline" href={`${base}?page=${n - 1}`}>← Previous page</Link> : <span className="text-zinc-400">← Previous page</span>}
        {n < pageCount ? <Link className="underline" href={`${base}?page=${n + 1}`}>Next page →</Link> : <span className="text-zinc-400">Next page →</span>}
      </nav>
      {page?.text ? (
        <pre className="whitespace-pre-wrap rounded border border-zinc-200 bg-zinc-50 p-4 font-sans text-sm text-zinc-900" data-testid="page-text">
          {page.text}
        </pre>
      ) : (
        <p className="text-sm text-zinc-600" data-testid="page-text-empty">
          No text on this page. It may be a drawing, a photo or a scanned page; check the original.
        </p>
      )}
    </PageShell>
  );
}
