"use client";

import { BookOpen, Code2, Loader2, Search, X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { SongRow } from "@/components/song-row";
import { TopBar } from "@/components/top-bar";
import {
  entryKey,
  type LibraryEntry,
  listFavourites,
  listRecent,
  toggleFavourite,
} from "@/lib/storage/library";
import { shortestQuery, useLiveSearch } from "@/lib/use-live-search";
import type { Viewer } from "@/server/auth";

type HomeProps = {
  viewer: Viewer | null;
  authEnabled: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
};

export function Home({ viewer, authEnabled, signIn, signOut }: HomeProps) {
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<readonly LibraryEntry[]>([]);
  const [favorites, setFavorites] = useState<readonly LibraryEntry[]>([]);
  const state = useLiveSearch(query);

  const refreshLibrary = useCallback(() => {
    void listRecent().then(setRecent);
    void listFavourites().then(setFavorites);
  }, []);

  useEffect(refreshLibrary, [refreshLibrary]);

  const favoriteKeys = new Set(favorites.map((entry) => entry.key));

  async function onToggleFavorite(entry: {
    url: string;
    name: string;
    source: string | null;
  }) {
    await toggleFavourite(entry);
    refreshLibrary();
  }

  const searching = state.status === "searching";
  const shown = "results" in state ? state.results : [];
  const announcement =
    state.status === "searching"
      ? "Searching"
      : state.status === "done"
        ? `${state.results.length} results`
        : "";
  const keepTyping = state.status === "typing";

  return (
    <>
      <TopBar
        viewer={viewer}
        authEnabled={authEnabled}
        signIn={signIn}
        signOut={signOut}
      />

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-5 py-14">
        <div className="flex flex-col gap-3">
          <h1 className="font-semibold text-4xl tracking-tight sm:text-5xl">
            Play anything.
          </h1>
          <p className="max-w-lg text-muted">
            Search a song, watch the notes fall, then take the keys yourself or
            race someone for them.
          </p>
        </div>

        <div className="relative">
          <Search
            className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-4 size-4 text-faint"
            aria-hidden="true"
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search for a song"
            aria-label="Search for a song"
            autoComplete="off"
            className="w-full rounded-xl border border-line bg-panel py-3.5 pr-11 pl-11 text-text outline-none transition-colors placeholder:text-faint focus:border-accent"
          />
          <div className="-translate-y-1/2 absolute top-1/2 right-3 flex items-center">
            {searching ? (
              <Loader2
                className="size-4 animate-spin text-accent"
                aria-label="Searching"
              />
            ) : query !== "" ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                data-tip="Clear"
                className="rounded-md p-1 text-faint transition-colors hover:text-text"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </div>

        {state.status === "failed" ? (
          <p className="text-danger text-sm">{state.message}</p>
        ) : null}

        <p aria-live="polite" role="status" className="sr-only">
          {announcement}
        </p>

        {keepTyping ? (
          <p className="text-faint text-sm">
            Keep typing, at least {shortestQuery} characters.
          </p>
        ) : null}

        {state.status === "done" && state.results.length === 0 ? (
          <p className="text-muted">Nothing matched that. Try fewer words.</p>
        ) : null}

        {shown.length > 0 ? (
          <Section
            title={`${shown.length} results`}
            dim={state.status === "searching"}
          >
            {shown.map((result) => (
              <SongRow
                key={`${result.source}-${result.id}`}
                name={result.name}
                url={result.downloadUrl}
                source={result.source}
                sourceUrl={result.sourceUrl}
                plays={result.plays}
                favorite={favoriteKeys.has(
                  entryKey(result.source, result.downloadUrl),
                )}
                onToggleFavorite={() =>
                  void onToggleFavorite({
                    url: result.downloadUrl,
                    name: result.name,
                    source: result.source,
                  })
                }
              />
            ))}
          </Section>
        ) : null}

        {state.status === "idle" && favorites.length > 0 ? (
          <Section title="Favorites">
            {favorites.map((entry) => (
              <SongRow
                key={entry.key}
                name={entry.name}
                url={entry.url}
                source={entry.source}
                sourceUrl={null}
                plays={null}
                favorite
                onToggleFavorite={() => void onToggleFavorite(entry)}
              />
            ))}
          </Section>
        ) : null}

        {state.status === "idle" && recent.length > 0 ? (
          <Section title="Recently played">
            {recent.map((entry) => (
              <SongRow
                key={entry.key}
                name={entry.name}
                url={entry.url}
                source={entry.source}
                sourceUrl={null}
                plays={null}
                favorite={favoriteKeys.has(entry.key)}
                onToggleFavorite={() => void onToggleFavorite(entry)}
              />
            ))}
          </Section>
        ) : null}
      </main>

      <footer className="mx-auto flex w-full max-w-3xl items-center gap-4 px-5 pb-10 font-mono text-faint text-xs">
        <a
          href="/docs"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 transition-colors hover:text-accent"
        >
          <BookOpen className="size-3.5" aria-hidden="true" />
          api docs
        </a>
        <a
          href="https://github.com/h4ks-com/kinesthesia"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 transition-colors hover:text-accent"
        >
          <Code2 className="size-3.5" aria-hidden="true" />
          source
        </a>
        <a
          href="https://bitmidi.com"
          target="_blank"
          rel="noreferrer"
          className="ml-auto transition-colors hover:text-accent"
        >
          midi from bitmidi
        </a>
      </footer>
    </>
  );
}

function Section({
  title,
  children,
  dim = false,
}: {
  title: string;
  children: ReactNode;
  dim?: boolean;
}) {
  return (
    <section
      className={`flex flex-col gap-1 transition-opacity ${dim ? "opacity-50" : ""}`}
    >
      <h2 className="label px-3 pb-1">{title}</h2>
      <ul className="flex flex-col">{children}</ul>
    </section>
  );
}
