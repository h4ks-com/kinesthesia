"use client";

import { BookOpen, Code2, Loader2, Search, Upload, X } from "lucide-react";
import Link from "next/link";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { LibrarySection } from "@/components/library-section";
import { SongRow } from "@/components/song-row";
import { TopBar } from "@/components/top-bar";
import {
  clearFavourites,
  clearRecent,
  entryKey,
  filterLibrary,
  type LibraryEntry,
  listFavourites,
  listRecent,
  toggleFavourite,
} from "@/lib/storage/library";
import {
  clearUploads,
  isLocalUrl,
  listUploads,
  storeUpload,
} from "@/lib/storage/uploads";
import { shortestQuery, useLiveSearch } from "@/lib/use-live-search";
import type { Viewer } from "@/server/auth";

type HomeProps = {
  viewer: Viewer | null;
  authEnabled: boolean;
  homeLink: string | null;
  chatLink: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
};

export function Home({
  viewer,
  authEnabled,
  homeLink,
  chatLink,
  signIn,
  signOut,
}: HomeProps) {
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<readonly LibraryEntry[]>([]);
  const [favorites, setFavorites] = useState<readonly LibraryEntry[]>([]);
  const [uploads, setUploads] = useState<readonly LibraryEntry[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const state = useLiveSearch(query);

  const refreshLibrary = useCallback(() => {
    void listRecent().then(setRecent);
    void listFavourites().then(setFavorites);
    void listUploads().then(setUploads);
  }, []);

  useEffect(refreshLibrary, [refreshLibrary]);

  const addFiles = useCallback(
    async (files: FileList | null) => {
      const midis = Array.from(files ?? []).filter((file) =>
        /\.midi?$/i.test(file.name),
      );
      if (midis.length === 0) {
        setUploadError("That doesn't look like a MIDI file.");
        return;
      }
      setUploadError(null);
      try {
        for (const file of midis) {
          await storeUpload(file.name, await file.arrayBuffer());
        }
      } catch {
        setUploadError("Could not save that file on this device.");
      }
      refreshLibrary();
    },
    [refreshLibrary],
  );

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
  const trimmed = query.trim();
  const matchedFavorites = filterLibrary(favorites, trimmed);
  const matchedUploads = filterLibrary(uploads, trimmed);
  const matchedRecent = filterLibrary(recent, trimmed).filter(
    (entry) => !isLocalUrl(entry.url),
  );

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
            title={trimmed === "" ? "Results" : "From the sources"}
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

        {matchedFavorites.length > 0 ? (
          <LibrarySection
            title="Favorites"
            count={matchedFavorites.length}
            action={
              <ClearButton
                label="Clear favorites"
                onClear={async () => {
                  await clearFavourites();
                  refreshLibrary();
                }}
              />
            }
          >
            {matchedFavorites.map((entry) => (
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
          </LibrarySection>
        ) : null}

        {matchedUploads.length > 0 ? (
          <LibrarySection
            title="Uploads"
            count={matchedUploads.length}
            action={
              <ClearButton
                label="Clear uploads"
                onClear={async () => {
                  await clearUploads();
                  refreshLibrary();
                }}
              />
            }
          >
            {matchedUploads.map((entry) => (
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
          </LibrarySection>
        ) : null}

        {matchedRecent.length > 0 ? (
          <LibrarySection
            title="Recently played"
            count={matchedRecent.length}
            action={
              <ClearButton
                label="Clear history"
                onClear={async () => {
                  await clearRecent();
                  refreshLibrary();
                }}
              />
            }
          >
            {matchedRecent.map((entry) => (
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
          </LibrarySection>
        ) : null}

        <div className="mt-auto">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              void addFiles(event.dataTransfer.files);
            }}
            className={`flex w-full items-center justify-center gap-2 rounded-xl border border-dashed py-4 font-mono text-xs transition-colors ${
              dragging
                ? "border-accent bg-accent-soft/30 text-accent"
                : "border-line text-faint hover:border-line-strong hover:text-muted"
            }`}
          >
            <Upload className="size-4" aria-hidden="true" />
            drop a midi file here, or click to choose
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".mid,.midi,audio/midi"
            multiple
            className="hidden"
            onChange={(event) => {
              void addFiles(event.target.files);
              event.target.value = "";
            }}
          />
          {uploadError === null ? null : (
            <p className="mt-2 text-danger text-sm">{uploadError}</p>
          )}
        </div>
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
        <Link href="/sources" className="transition-colors hover:text-accent">
          midi sources
        </Link>

        <span className="ml-auto flex items-center gap-4">
          {homeLink === null ? null : (
            <a
              href={homeLink}
              target="_blank"
              rel="noreferrer"
              className="transition-colors hover:text-accent"
            >
              h4ks
            </a>
          )}
          {chatLink === null ? null : (
            <a
              href={chatLink}
              target="_blank"
              rel="noreferrer"
              className="transition-colors hover:text-accent"
            >
              chat
            </a>
          )}
        </span>
      </footer>
    </>
  );
}

function ClearButton({
  label,
  onClear,
}: {
  label: string;
  onClear: () => Promise<void>;
}) {
  return (
    <button
      type="button"
      onClick={() => void onClear()}
      aria-label={label}
      data-tip={label}
      className="rounded-md px-2 py-1 font-mono text-faint text-xs transition-colors hover:text-danger"
    >
      clear
    </button>
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
