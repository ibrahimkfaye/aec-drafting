import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { publicSupabaseEnv } from "@/lib/env";

/**
 * Supabase client that acts AS THE SIGNED-IN USER (publishable key + session
 * cookie), so database row-level security always applies. Create one per request.
 */
export async function createClient() {
  // Request time only: the auth library checks token expiry against the clock,
  // and session data must never be prerendered or cached across requests.
  await connection();
  const cookieStore = await cookies();
  const { url, key } = publicSupabaseEnv();
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // proxy.ts refreshes the session cookie on every request instead.
        }
      },
    },
  });
}
