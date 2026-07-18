import Link from "next/link";

export function MissingSong() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-[#05060a] text-zinc-300">
      <p>That link has no playable song on it.</p>
      <Link
        href="/"
        className="rounded-lg border border-zinc-700 px-4 py-2 text-sm"
      >
        Find a song
      </Link>
    </main>
  );
}
