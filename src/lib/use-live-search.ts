"use client";

import { useEffect, useState } from "react";
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

export function useLiveSearch(query: string): SearchState {
  const [state, setState] = useState<SearchState>({ status: "idle" });

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed === "") {
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
