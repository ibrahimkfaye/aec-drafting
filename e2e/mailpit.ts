/** Helpers for the LOCAL Supabase test inbox (Mailpit). Never points at real email. */
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

type SearchResult = { messages?: { ID: string }[] };

async function search(email: string): Promise<SearchResult> {
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
  if (!res.ok) throw new Error(`Test inbox not reachable at ${MAILPIT} (HTTP ${res.status})`);
  return (await res.json()) as SearchResult;
}

export async function clearInbox() {
  try {
    await fetch(`${MAILPIT}/api/v1/messages`, { method: "DELETE" });
  } catch {
    throw new Error(`Test inbox not reachable at ${MAILPIT}. Is local Supabase running (npm run db:start)?`);
  }
}

export async function countMessagesTo(email: string): Promise<number> {
  return (await search(email)).messages?.length ?? 0;
}

/** Waits for the newest email to `email` and returns its /auth/confirm link. */
export async function waitForSignInLink(email: string, timeoutMs = 15_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const id = (await search(email)).messages?.[0]?.ID;
    if (id) {
      const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()) as { HTML?: string; Text?: string };
      const content = `${msg.HTML ?? ""} ${msg.Text ?? ""}`.replace(/&amp;/g, "&");
      const link = content.match(/https?:\/\/[^\s"'<>]+\/auth\/confirm\?[^\s"'<>]+/)?.[0];
      if (link) return link;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No sign-in email for ${email} within ${timeoutMs}ms`);
}
