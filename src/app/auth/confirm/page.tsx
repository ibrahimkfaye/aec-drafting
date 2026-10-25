import { Suspense } from "react";
import { confirmParamsSchema } from "@/lib/validation";
import { confirmSignIn } from "./actions";

type Props = { searchParams: Promise<{ token_hash?: string; type?: string }> };

/**
 * Landing page for the emailed link. Opening the link does NOT sign in: email
 * security scanners (e.g. Microsoft 365 Safe Links) open links automatically and
 * would otherwise use up the one-time token. The person must press the button.
 */
export default function ConfirmPage({ searchParams }: Props) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 p-8">
      <h1 className="text-2xl font-semibold">Finish signing in</h1>
      <Suspense fallback={null}>
        <ConfirmForm searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function ConfirmForm({ searchParams }: Props) {
  const parsed = confirmParamsSchema.safeParse(await searchParams);
  if (!parsed.success) {
    return (
      <p role="alert" className="text-sm text-red-800">
        This sign-in link is not valid. <a className="underline" href="/login">Request a new one</a>.
      </p>
    );
  }
  return (
    <form action={confirmSignIn}>
      <input type="hidden" name="token_hash" value={parsed.data.token_hash} />
      <input type="hidden" name="type" value={parsed.data.type} />
      <button type="submit" className="w-full rounded bg-zinc-900 px-4 py-2 text-white">
        Continue signing in
      </button>
    </form>
  );
}
