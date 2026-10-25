"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side client (publishable key + the user's session). Used ONLY to send
 * file bytes to a one-time signed upload URL issued by the server. All checks and
 * records happen on the server and in the database.
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase is not configured.");
  return createBrowserClient(url, key);
}
