"use client";

import { useEffect, useRef, useState } from "react";
import { searchItem } from "@/lib/midi/listing";
import { interleave, ranked } from "@/lib/midi/relevance";
import { searchBitmidi } from "@/lib/midi/sources/bitmidi";
import type {
  MidiListing,
  MidiSearchItem,
  MidiSourceId,
} from "@/server/midi/types";

/** Named where a source was asked and did not answer, so a short list reads as
 * a source being down rather than as the catalogue holding nothing. */
export type SearchState =
  | { status: "idle" }
  | { status: "typing" }
  | {
      status: "searching";
      results: readonly MidiSearchItem[];
      missing: readonly string[];
    }
  | { status: "failed"; message: string }
  | {
      status: "done";
      results: readonly MidiSearchItem[];
      missing: readonly string[];
    };

/** How long typing has to stop before a search leaves the browser. The sources
 * are small sites that answer a burst with errors, so this is set by what is
 * polite to them rather than by what feels quickest here. */
const settleDelay = 500;
export const shortestQuery = 3;
const resultLimit = 20;
/** What a reader waits for a source they are asking themselves. Long, because
 * nothing waits on it: their site answers in a fifth of a second on a good day
 * and stalls for half a minute on a bad one, and everything else found is on
 * screen either way. */
const directTimeout = 30000;

/** Reached from here rather than through our own server, which their Cloudflare
 * turns away. Named to the server too, so it answers with everything else
 * instead of holding those results behind an attempt that is not needed. */
const askedHere: readonly MidiSourceId[] = ["bitmidi"];

function listingKey(listing: MidiListing): string {
  return `${listing.source}:${listing.id}`;
}

async function askServer(
  query: string,
  signal: AbortSignal,
): Promise<readonly MidiSearchItem[]> {
  const response = await fetch(
    `/api/midi/search?q=${encodeURIComponent(query)}&limit=${resultLimit}&skip=${askedHere.join(",")}`,
    { signal },
  );
  if (!response.ok) {
    throw new Error(`Search failed with status ${response.status}`);
  }
  const body: { results: readonly MidiSearchItem[] } = await response.json();
  return body.results;
}

function askDirect(
  query: string,
  signal: AbortSignal,
): Promise<readonly MidiListing[]> {
  return searchBitmidi(query, (url) =>
    fetch(url, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(directTimeout)]),
    }),
  );
}

/** A listing is the same wherever it was found, so anything the server already
 * had is dropped rather than shown twice. */
function merge(
  served: readonly MidiSearchItem[],
  direct: readonly MidiListing[],
  query: string,
): readonly MidiSearchItem[] {
  const seen = new Set(served.map(listingKey));
  const here = window.location.origin;
  const extra = ranked(direct, query)
    .filter((listing) => !seen.has(listingKey(listing)))
    .map((listing) => searchItem(listing, here));
  return interleave([served, extra], resultLimit);
}

/** The last search that finished, held outside React so opening a song and
 * coming back shows what was already found rather than asking the sources
 * again. Only a mount reads it: any typing searches afresh. Never populated on
 * the server, where one module would otherwise be every visitor's. */
let lastSearch: { query: string; results: readonly MidiSearchItem[] } | null =
  null;

export function lastSearchQuery(): string {
  return lastSearch?.query ?? "";
}

export function useLiveSearch(query: string): SearchState {
  const [state, setState] = useState<SearchState>(() =>
    lastSearch !== null && lastSearch.query === query.trim()
      ? { status: "done", results: lastSearch.results, missing: [] }
      : { status: "idle" },
  );
  const restored = useRef(state.status === "done" ? query.trim() : null);

  useEffect(() => {
    const trimmed = query.trim();
    if (restored.current === trimmed) {
      return;
    }
    restored.current = null;
    if (trimmed === "") {
      lastSearch = null;
      setState({ status: "idle" });
      return;
    }
    if (trimmed.length < shortestQuery) {
      setState({ status: "typing" });
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      setState((current) => ({
        status: "searching",
        results: "results" in current ? current.results : [],
        missing: [],
      }));
      // Each source is shown the moment it answers rather than the pair being
      // waited on: BitMidi takes a fifth of a second on a good day and half a
      // minute on a bad one, and nothing else on screen should wait for that.
      const answers = {
        served: null as readonly MidiSearchItem[] | null,
        direct: [] as readonly MidiListing[],
        servedFailed: false,
        directFailed: false,
        outstanding: 2,
      };
      const publish = () => {
        answers.outstanding -= 1;
        if (controller.signal.aborted) {
          return;
        }
        if (answers.servedFailed && answers.directFailed) {
          setState({ status: "failed", message: "Search failed" });
          return;
        }
        const results = merge(answers.served ?? [], answers.direct, trimmed);
        const missing = answers.directFailed ? ["BitMidi"] : [];
        if (answers.outstanding === 0) {
          lastSearch = { query: trimmed, results };
          setState({ status: "done", results, missing });
          return;
        }
        setState({ status: "searching", results, missing });
      };
      askServer(trimmed, controller.signal)
        .then((found) => {
          answers.served = found;
        })
        .catch(() => {
          answers.servedFailed = true;
        })
        .finally(publish);
      askDirect(trimmed, controller.signal)
        .then((found) => {
          answers.direct = found;
        })
        .catch(() => {
          answers.directFailed = true;
        })
        .finally(publish);
    }, settleDelay);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  return state;
}
