"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { confirmParamsSchema } from "@/lib/validation";

/** Completes magic-link sign-in. Runs only on an explicit button press (POST). */
export async function confirmSignIn(formData: FormData) {
  const parsed = confirmParamsSchema.safeParse({
    token_hash: formData.get("token_hash"),
    type: formData.get("type"),
  });
  if (!parsed.success) redirect("/login?error=link_invalid");

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp(parsed.data);
  if (error) {
    console.warn("[auth] magic link verification failed", { code: error.code ?? "unknown" });
    redirect("/login?error=link_invalid");
  }
  redirect("/dashboard");
}
