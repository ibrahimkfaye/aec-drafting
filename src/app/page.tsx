export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-4 p-8">
      <p className="w-fit rounded bg-amber-100 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-amber-900">
        Development build — not for confidential data
      </p>
      <h1 className="text-2xl font-semibold">AEC Drafting Pilot</h1>
      <p className="text-zinc-600">
        Phase 1 (non-AI foundation) is in progress. Sign-in, projects, uploads and evidence
        review are not available yet.
      </p>
    </main>
  );
}
