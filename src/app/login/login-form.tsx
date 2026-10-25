"use client";

import { useActionState } from "react";
import { requestMagicLink, type LoginState } from "./actions";

const initial: LoginState = { status: "idle" };

export function LoginForm() {
  const [state, action, pending] = useActionState(requestMagicLink, initial);

  if (state.status === "sent") {
    return (
      <p role="status" className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
        If that email belongs to a pilot user, a sign-in link is on its way. It expires in 15
        minutes. You can request a new link after one minute.
      </p>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-3">
      <label htmlFor="email" className="text-sm font-medium">
        Work email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        required
        autoComplete="email"
        className="rounded border border-zinc-300 px-3 py-2"
      />
      {state.status === "invalid" && (
        <p role="alert" className="text-sm text-red-700">
          Enter a valid email address.
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-zinc-900 px-4 py-2 text-white disabled:opacity-50"
      >
        {pending ? "Sending…" : "Email me a sign-in link"}
      </button>
    </form>
  );
}
