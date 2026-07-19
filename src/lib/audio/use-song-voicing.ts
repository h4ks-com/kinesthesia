"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  clampVoicing,
  type SongVoicing,
  type Voicing,
} from "@/lib/audio/voicing";
import type { PlayerParams } from "@/lib/player-url";

/** One shared identity for "nothing is shaped", so the render loop is not
 * handed a new map on every frame. */
const noVoicing: SongVoicing = new Map();

type SavedVoicing = {
  readonly authorId: string;
  readonly authorName: string;
  readonly tracks: SongVoicing;
  readonly updatedAt: number;
};

type Reply = {
  readonly voicings: readonly {
    readonly authorId: string;
    readonly authorName: string;
    readonly tracks: Record<string, Voicing>;
    readonly updatedAt: number;
  }[];
};

export type SongVoicingState = {
  readonly voicing: SongVoicing;
  /** Whose version is playing. Empty while it is the file's own or yours in
   * progress. */
  readonly playing: string;
  readonly dirty: boolean;
  readonly change: (track: number, voicing: Voicing) => void;
  readonly reset: () => void;
  readonly save: () => Promise<void>;
};

function asVoicing(tracks: Record<string, Voicing>): SongVoicing {
  return new Map(
    Object.entries(tracks).map(([track, voicing]) => [
      Number(track),
      clampVoicing(voicing),
    ]),
  );
}

/** Two voicings sound the same when they name the same tracks and shape each
 * one the same way. */
function same(one: SongVoicing, other: SongVoicing): boolean {
  if (one.size !== other.size) {
    return false;
  }
  for (const [track, voicing] of one) {
    const against = other.get(track);
    if (
      against === undefined ||
      against.program !== voicing.program ||
      against.attack !== voicing.attack ||
      against.release !== voicing.release ||
      against.brightness !== voicing.brightness ||
      against.volume !== voicing.volume
    ) {
      return false;
    }
  }
  return true;
}

function asRecord(voicing: SongVoicing): Record<string, Voicing> {
  return Object.fromEntries(
    [...voicing].map(([track, entry]) => [String(track), entry]),
  );
}

/** Precedence, in one place: what you picked this session, then your own saved
 * version, then whoever shaped it last, then the instruments in the file. */
export function useSongVoicing(
  params: PlayerParams,
  viewerId: string | null,
): SongVoicingState {
  const [saved, setSaved] = useState<readonly SavedVoicing[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [edited, setEdited] = useState<SongVoicing | null>(null);
  const url = params.url;
  const source = params.source ?? "";
  const query = `url=${encodeURIComponent(url)}&source=${encodeURIComponent(source)}`;

  const load = useCallback(async (): Promise<readonly SavedVoicing[]> => {
    const response = await fetch(`/api/voicings?${query}`);
    if (!response.ok) {
      return [];
    }
    const reply: Reply = await response.json();
    return reply.voicings.map((entry) => ({
      ...entry,
      tracks: asVoicing(entry.tracks),
    }));
  }, [query]);

  useEffect(() => {
    let live = true;
    setEdited(null);
    setPicked(null);
    setSaved([]);
    load()
      .then((rows) => {
        if (live) {
          setSaved(rows);
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [load]);

  const mine = saved.find((entry) => entry.authorId === viewerId) ?? null;
  const chosen =
    saved.find((entry) => entry.authorId === picked) ??
    mine ??
    saved[0] ??
    null;
  const settled = chosen?.tracks ?? noVoicing;
  const voicing = edited ?? settled;
  const dirty = edited !== null && !same(edited, settled);

  const base = useRef(voicing);
  base.current = voicing;

  const change = useCallback(
    (track: number, next: Voicing) => {
      setEdited((current) => {
        const merged = new Map(current ?? settled);
        merged.set(track, clampVoicing(next));
        return merged;
      });
    },
    [settled],
  );

  const reset = useCallback(() => {
    setPicked(null);
    setEdited(new Map());
  }, []);

  const save = useCallback(async () => {
    const response = await fetch("/api/voicings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, source, tracks: asRecord(base.current) }),
    });
    if (!response.ok) {
      return;
    }
    setSaved(await load());
    setEdited(null);
    setPicked(null);
  }, [url, source, load]);

  return {
    voicing,
    playing: dirty ? "" : (chosen?.authorName ?? ""),
    dirty,
    change,
    reset,
    save,
  };
}
