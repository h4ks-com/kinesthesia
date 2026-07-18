"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { SongRow } from "@/components/song-row";
import {
  entryKey,
  type LibraryEntry,
  listFavourites,
  listRecent,
  toggleFavourite,
} from "@/lib/storage/library";
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
  const [recent, setRecent] = useState<readonly LibraryEntry[]>([]);
  const [favourites, setFavourites] = useState<readonly LibraryEntry[]>([]);

  const refreshLibrary = useCallback(() => {
    void listRecent().then(setRecent);
    void listFavourites().then(setFavourites);
  }, []);

  useEffect(refreshLibrary, [refreshLibrary]);

  const favouriteKeys = new Set(favourites.map((entry) => entry.key));

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

  async function onToggleFavourite(entry: {
    url: string;
    name: string;
    source: string | null;
  }) {
    await toggleFavourite(entry);
    refreshLibrary();
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-6 py-16">
      <header className="flex flex-col gap-2">
        <h1 className="font-semibold text-4xl tracking-tight">Kinesthesia</h1>
        <p className="text-zinc-500">
          Find a song, then watch it play, learn it at your own pace, or take
          someone on.
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

      {state.status === "done" && state.results.length > 0 ? (
        <Section title="Results">
          {state.results.map((result) => (
            <SongRow
              key={`${result.source}-${result.id}`}
              name={result.name}
              url={result.downloadUrl}
              source={result.source}
              detail={`${result.source} · ${result.plays.toLocaleString()} plays`}
              favourite={favouriteKeys.has(
                entryKey(result.source, result.downloadUrl),
              )}
              onToggleFavourite={() =>
                void onToggleFavourite({
                  url: result.downloadUrl,
                  name: result.name,
                  source: result.source,
                })
              }
            />
          ))}
        </Section>
      ) : null}

      {favourites.length > 0 ? (
        <Section title="Favourites">
          {favourites.map((entry) => (
            <SongRow
              key={entry.key}
              name={entry.name}
              url={entry.url}
              source={entry.source}
              detail={entry.source}
              favourite
              onToggleFavourite={() => void onToggleFavourite(entry)}
            />
          ))}
        </Section>
      ) : null}

      {recent.length > 0 ? (
        <Section title="Recently played">
          {recent.map((entry) => (
            <SongRow
              key={entry.key}
              name={entry.name}
              url={entry.url}
              source={entry.source}
              detail={entry.source}
              favourite={favouriteKeys.has(entry.key)}
              onToggleFavourite={() => void onToggleFavourite(entry)}
            />
          ))}
        </Section>
      ) : null}
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-medium text-sm text-zinc-500 uppercase tracking-wide">
        {title}
      </h2>
      <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
        {children}
      </ul>
    </section>
  );
}
