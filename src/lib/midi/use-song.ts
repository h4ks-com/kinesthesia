"use client";

import { useEffect, useState } from "react";
import { loadSong, type Song } from "@/lib/midi/song";
import type { PlayerParams } from "@/lib/player-url";
import { recordPlay } from "@/lib/storage/library";
import { isLocalUrl } from "@/lib/storage/uploads";

export type SongState =
  | { status: "loading" }
  | { status: "failed"; message: string }
  | { status: "ready"; song: Song };

export function useSong(params: PlayerParams | null): SongState {
  const [state, setState] = useState<SongState>({ status: "loading" });
  const url = params?.url ?? null;
  const name = params?.name ?? null;
  const source = params?.source ?? null;

  useEffect(() => {
    if (url === null || name === null) {
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    loadSong(url, name)
      .then((song) => {
        if (cancelled) {
          return;
        }
        setState({ status: "ready", song });
        if (!isLocalUrl(url)) {
          void recordPlay({ url, name, source });
        }
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
