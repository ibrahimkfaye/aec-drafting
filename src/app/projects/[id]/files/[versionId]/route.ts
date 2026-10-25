import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser, requireMembership } from "@/lib/auth";
import { BUCKET, getVersion } from "@/lib/sources";
import { createClient } from "@/lib/supabase/server";

/**
 * Download a stored original. Checks the user and firm on the server, then
 * redirects to a signed storage URL that expires in 60 seconds and forces
 * "download" (the file is never displayed inside the app).
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string; versionId: string }> }) {
  const { id, versionId } = await ctx.params;
  const notFound = () => new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(versionId).success) return notFound();
  if (!(await getCurrentUser())) return new NextResponse("Sign in required", { status: 401 });

  const m = await requireMembership();
  const v = await getVersion(m.orgId, id, versionId);
  if (!v || v.status !== "stored" || !v.storage_path) return notFound();

  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(v.storage_path, 60, { download: v.original_filename });
  if (error || !data) return notFound();
  return NextResponse.redirect(data.signedUrl, { status: 303, headers: { "Cache-Control": "no-store" } });
}
