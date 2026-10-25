import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type MemberRole = "admin" | "author" | "reviewer" | "viewer";
export type CurrentUser = { id: string; email: string | null };
export type CurrentMembership = { user: CurrentUser; orgId: string; orgName: string; role: MemberRole };

/** Verified identity from the session token (signature checked by getClaims). */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  const email = typeof data.claims.email === "string" ? data.claims.email : null;
  return { id: data.claims.sub, email };
});

/** Use at the top of every protected page/action. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Signed-in user's firm and role, read from the database (not from the token). */
export const requireMembership = cache(async (): Promise<CurrentMembership> => {
  const user = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("memberships")
    .select("org_id, role, organizations(name)")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw new Error("Could not load firm membership.");
  if (!data) redirect("/no-access");
  const org = data.organizations as unknown as { name: string } | null;
  return { user, orgId: data.org_id, orgName: org?.name ?? "", role: data.role as MemberRole };
});

export function hasRole(m: CurrentMembership, roles: MemberRole[]): boolean {
  return roles.includes(m.role);
}
