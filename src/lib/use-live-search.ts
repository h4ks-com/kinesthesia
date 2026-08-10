"use client";

import { useEffect, useRef, useState } from "react";
import type { MidiSearchItem } from "@/server/midi/types";

export type SearchState =
  | { status: "idle" }
  | { status: "typing" }
  | { status: "searching"; results: readonly MidiSearchItem[] }
  | { status: "failed"; message: string }
  | { status: "done"; results: readonly MidiSearchItem[] };

/** How long typing has to stop before a search leaves the browser. The sources
 * are small sites that answer a burst with errors, so this is set by what is
 * polite to them rather than by what feels quickest here. */
const settleDelay = 500;
export const shortestQuery = 3;

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
      ? { status: "done", results: lastSearch.results }
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
      }));
      fetch(`/api/midi/search?q=${encodeURIComponent(trimmed)}&limit=20`, {
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`Search failed with status ${response.status}`);
          }
          const body: { results: readonly MidiSearchItem[] } =
            await response.json();
          lastSearch = { query: trimmed, results: body.results };
          setState({ status: "done", results: body.results });
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }
          setState({
            status: "failed",
            message: error instanceof Error ? error.message : "Search failed",
          });
        });
    }, settleDelay);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  return state;
}
