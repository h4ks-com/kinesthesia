"use client";

import { type FormEvent, useState } from "react";
import type { MidiSearchItem } from "@/server/midi/types";

type SearchState =
  | { status: "idle" }
  | { status: "searching" }
  | { status: "failed"; message: string }
  | { status: "done"; results: readonly MidiSearchItem[] };

async function fetchResults(query: string): Promise<readonly MidiSearchItem[]> {
  const response = await fetch(
    `/api/midi/search?q=${encodeURIComponent(query)}&limit=20`,
  );
  if (!response.ok) {
    throw new Error(`Search failed with status ${response.status}`);
  }
  const body: { results: readonly MidiSearchItem[] } = await response.json();
  return body.results;
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<SearchState>({ status: "idle" });

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = query.trim();
    if (trimmed === "") {
      return;
    }
    setState({ status: "searching" });
    try {
      setState({ status: "done", results: await fetchResults(trimmed) });
    } catch (error) {
      setState({
        status: "failed",
        message: error instanceof Error ? error.message : "Search failed",
      });
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-2">
        <h1 className="font-semibold text-4xl tracking-tight">Kinesthesia</h1>
        <p className="text-zinc-500">
          Find a song, then watch it play or sit down and play it yourself.
        </p>
      </header>

      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search for a song"
          aria-label="Search for a song"
          className="flex-1 rounded-lg border border-zinc-300 bg-transparent px-4 py-2.5 outline-none focus:border-zinc-500 dark:border-zinc-700"
        />
        <button
          type="submit"
          className="rounded-lg bg-zinc-900 px-5 py-2.5 font-medium text-white dark:bg-white dark:text-zinc-900"
        >
          Search
        </button>
      </form>

      {state.status === "searching" ? (
        <p className="text-zinc-500">Searching</p>
      ) : null}

      {state.status === "failed" ? (
        <p className="text-red-600 dark:text-red-400">{state.message}</p>
      ) : null}

      {state.status === "done" && state.results.length === 0 ? (
        <p className="text-zinc-500">Nothing found for that one.</p>
      ) : null}

      {state.status === "done" ? (
        <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
          {state.results.map((result) => (
            <li
              key={`${result.source}-${result.id}`}
              className="flex items-center justify-between gap-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{result.name}</p>
                <p className="text-sm text-zinc-500">
                  {result.source} · {result.plays.toLocaleString()} plays
                </p>
              </div>
              <a
                href={result.playUrl}
                className="shrink-0 rounded-lg border border-zinc-300 px-4 py-2 font-medium text-sm dark:border-zinc-700"
              >
                Watch
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </main>
  );
}
