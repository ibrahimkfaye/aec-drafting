import { signOut } from "@/app/actions/auth";

export function SignOutButton() {
  return (
    <form action={signOut}>
      <button type="submit" className="rounded border border-zinc-300 px-3 py-1.5 text-sm">
        Sign out
      </button>
    </form>
  );
}
