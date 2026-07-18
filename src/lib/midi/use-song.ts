"use client";

import { useEffect, useState } from "react";
import { loadSong, type Song } from "@/lib/midi/song";
import type { PlayerParams } from "@/lib/player-url";
import { recordPlay } from "@/lib/storage/library";

export type SongState =
  | { status: "loading" }
  | { status: "failed"; message: string }
  | { status: "ready"; song: Song };

export function useSong(params: PlayerParams): SongState {
  const [state, setState] = useState<SongState>({ status: "loading" });
  const { url, name, source } = params;

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    loadSong(url, name)
      .then((song) => {
        if (cancelled) {
          return;
        }
        setState({ status: "ready", song });
        void recordPlay({ url, name, source });
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setState({
          status: "failed",
          message:
            error instanceof Error ? error.message : "Could not load that song",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [url, name, source]);

  return state;
}
