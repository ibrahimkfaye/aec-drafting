/**
 * SERVICE-ROLE Supabase client. Bypasses row-level security.
 *
 * Used ONLY by background job code (src/lib/jobs, src/trigger), which runs in the
 * Trigger.dev worker — or, for local development only, inside `npm run dev`.
 * Never import this from pages, components or user-facing actions.
 * (No `server-only` import here: that package throws outside Next.js, and the
 * worker is not Next.js. The key is not NEXT_PUBLIC_, so it can never reach a browser.)
 */
import { createClient } from "@supabase/supabase-js";

export function createAdminClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Worker is missing SUPABASE_URL / SUPABASE_SECRET_KEY.");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}
