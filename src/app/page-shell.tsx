import Link from "next/link";

/** Common page frame: back link + title area. */
export function PageShell({ back, children }: { back?: { href: string; label: string }; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-8">
      {back && (
        <Link href={back.href} className="text-sm text-zinc-600 underline">
          ← {back.label}
        </Link>
      )}
      {children}
    </main>
  );
}

export function NotAllowed() {
  return (
    <p role="alert" data-testid="not-allowed" className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      Your role cannot create or edit projects. Ask an admin or author.
    </p>
  );
}
