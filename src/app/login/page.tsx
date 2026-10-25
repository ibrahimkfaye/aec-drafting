import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { LoginForm } from "./login-form";

const ERRORS: Record<string, string> = {
  link_invalid: "That sign-in link is invalid, expired, or already used. Request a new one.",
};

type Props = { searchParams: Promise<{ error?: string }> };

export default function LoginPage({ searchParams }: Props) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 p-8">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <Suspense fallback={null}>
        <LoginBody searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function LoginBody({ searchParams }: Props) {
  if (await getCurrentUser()) redirect("/dashboard");
  const { error } = await searchParams;
  const message = error ? ERRORS[error] : undefined;
  return (
    <>
      {message && (
        <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {message}
        </p>
      )}
      <LoginForm />
    </>
  );
}
