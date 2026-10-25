import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { SignOutButton } from "@/app/sign-out-button";

export default function NoAccessPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 p-8">
      <h1 className="text-2xl font-semibold">No firm access</h1>
      <Suspense fallback={null}>
        <Details />
      </Suspense>
    </main>
  );
}

async function Details() {
  const user = await requireUser();
  return (
    <>
      <p className="text-zinc-600">
        {user.email} is signed in but has not been added to a firm. Ask your administrator to add you.
      </p>
      <SignOutButton />
    </>
  );
}
