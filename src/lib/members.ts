/** Pure helpers for firm member lists (no server or database access). */
export type MemberRole = "admin" | "author" | "reviewer" | "viewer";
export type Member = { user_id: string; display_name: string; email: string; role: MemberRole };

export function eligibleReviewers(members: Member[]): Member[] {
  return members.filter((m) => m.role === "reviewer" || m.role === "admin");
}

export function memberLabel(members: Member[], userId: string | null): string {
  if (!userId) return "—";
  const m = members.find((x) => x.user_id === userId);
  return m ? m.display_name || m.email || "Unnamed member" : "Former member";
}
