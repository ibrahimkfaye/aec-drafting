"use server";

import { createClient } from "@/lib/supabase/server";
import { emailSchema } from "@/lib/validation";

export type LoginState = { status: "idle" | "sent" | "invalid" };

/**
 * Requests a magic link. Always returns the same "sent" result for any valid
 * address, so the page never reveals who has an account. New accounts are
 * never created here (shouldCreateUser: false, and sign-ups are disabled in Supabase).
 */
export async function requestMagicLink(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) return { status: "invalid" };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data,
    options: { shouldCreateUser: false },
  });
  // Log only a non-identifying error code — never the email address.
  if (error) console.warn("[auth] magic link not sent", { code: error.code ?? String(error.status ?? "unknown") });

  return { status: "sent" };
}
