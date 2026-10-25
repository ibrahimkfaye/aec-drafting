import { Suspense } from "react";
import { requireMembership } from "@/lib/auth";
import { SignOutButton } from "@/app/sign-out-button";

export default function DashboardPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-8">
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <Dashboard />
      </Suspense>
    </main>
  );
}

async function Dashboard() {
  const m = await requireMembership();
  return (
    <>
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{m.orgName}</h1>
          <p className="text-sm text-zinc-600">
            Signed in as <span data-testid="user-email">{m.user.email}</span> ·{" "}
            <span data-testid="user-role">{m.role}</span>
          </p>
        </div>
        <SignOutButton />
      </header>
      <section className="rounded border border-dashed border-zinc-300 p-6 text-sm text-zinc-600">
        Projects will appear here (milestone 1.6).
      </section>
    </>
  );
}
