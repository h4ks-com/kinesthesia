"use client";

import { BookOpen, Code2, Loader2, Play, Search, X } from "lucide-react";
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
import { ConfirmButton } from "@/components/ui/confirm-button";
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
  deleteUpload,
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

/** A pasted http(s) link, so the search box doubles as a way to open a MIDI by
 * URL. Whether it plays is the watch page's call: only trusted origins pass. */
function midiUrlFrom(query: string): { url: string; name: string } | null {
  const value = query.trim();
  if (!/^https?:\/\//i.test(value)) {
    return null;
  }
  try {
    const parsed = new URL(value);
    const last = parsed.pathname.split("/").filter(Boolean).pop() ?? "";
    return {
      url: value,
      name: last === "" ? parsed.hostname : decodeURIComponent(last),
    };
  } catch {
    return null;
  }
}

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
  const link = midiUrlFrom(query);
  const state = useLiveSearch(link === null ? query : "");

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

      <main
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(event) => {
          const to = event.relatedTarget;
          if (!(to instanceof Node) || !event.currentTarget.contains(to)) {
            setDragging(false);
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void addFiles(event.dataTransfer.files);
        }}
        className="relative mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-5 py-14"
      >
        {dragging ? (
          <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-2xl border-2 border-accent border-dashed bg-void/80 backdrop-blur">
            <p className="font-mono text-accent text-sm">
              drop to add your MIDI
            </p>
          </div>
        ) : null}

        <div className="flex flex-col gap-3">
          <h1 className="font-semibold text-4xl tracking-tight sm:text-5xl">
            Play anything.
          </h1>
          <p className="max-w-lg text-muted">
            Search a song, watch the notes fall, then take the keys yourself or
            race someone for them.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <div className="relative">
            <Search
              className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-4 size-4 text-faint"
              aria-hidden="true"
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search for a song, or paste a link"
              aria-label="Search for a song, or paste a link"
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
          <p className="px-1 font-mono text-[0.7rem] text-faint">
            Drop a file anywhere, or{" "}
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="text-muted underline decoration-line-strong underline-offset-2 transition-colors hover:text-accent"
            >
              browse
            </button>
            .
          </p>
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
            <p className="px-1 text-danger text-sm">{uploadError}</p>
          )}
        </div>

        {link === null ? null : (
          <Link
            href={`/watch?url=${encodeURIComponent(link.url)}&name=${encodeURIComponent(link.name)}`}
            className="group flex items-center gap-3 rounded-xl border border-accent/40 bg-accent-soft/20 px-4 py-3.5 transition-colors hover:border-accent"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-void">
              <Play className="size-4" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block truncate font-medium text-sm">
                {link.name}
              </span>
              <span className="block font-mono text-[0.7rem] text-faint">
                open this link
              </span>
            </span>
          </Link>
        )}

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
          <p className="text-muted">
            Nothing matched that. Try fewer words, or drop your own MIDI file.
          </p>
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
              <ConfirmButton
                label="clear"
                ariaLabel="Clear favorites"
                message="Remove all favorites?"
                confirmLabel="clear all"
                onConfirm={async () => {
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
              <ConfirmButton
                label="clear"
                ariaLabel="Clear uploads"
                message="Delete all uploaded files?"
                confirmLabel="delete all"
                onConfirm={async () => {
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
                onRemove={() =>
                  void deleteUpload(entry.url).then(refreshLibrary)
                }
              />
            ))}
          </LibrarySection>
        ) : null}

        {matchedRecent.length > 0 ? (
          <LibrarySection
            title="Recently played"
            count={matchedRecent.length}
            action={
              <ConfirmButton
                label="clear"
                ariaLabel="Clear history"
                message="Clear your play history?"
                confirmLabel="clear all"
                onConfirm={async () => {
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
