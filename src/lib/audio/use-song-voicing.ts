"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDeviceVoicing } from "@/lib/audio/use-device-voicing";
import {
  asRecord,
  asVoicing,
  clampVoicing,
  type SongVoicing,
  type StoredVoicing,
  type Voicing,
} from "@/lib/audio/voicing";
import type { PlayerParams } from "@/lib/player-url";
import { forgetSongVoicing, loadSongVoicing } from "@/lib/storage/settings";

/** One shared identity for "nothing is shaped", so the render loop is not
 * handed a new map on every frame. */
const noVoicing: SongVoicing = new Map();

export type SavedVoicing = {
  readonly authorId: string;
  readonly authorName: string;
  readonly tracks: SongVoicing;
  readonly updatedAt: number;
};

type Reply = {
  readonly voicings: readonly {
    readonly authorId: string;
    readonly authorName: string;
    readonly tracks: StoredVoicing;
    readonly updatedAt: number;
  }[];
};

export type SongVoicingState = {
  readonly voicing: SongVoicing;
  /** Everyone's saved version, newest first, so one can be picked to hear. */
  readonly saved: readonly SavedVoicing[];
  /** Whose version is playing. Empty while it is the file's own or yours in
   * progress. */
  readonly playing: string;
  readonly dirty: boolean;
  readonly change: (track: number, voicing: Voicing) => void;
  readonly adopt: (authorId: string) => void;
  readonly reset: () => void;
  readonly save: () => Promise<void>;
};

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
      against.volume !== voicing.volume ||
      against.color !== voicing.color
    ) {
      return false;
    }
  }
  return true;
}

/** Precedence, in one place: what you picked this session, then your own saved
 * version, then whoever shaped it last. Null falls back to the instruments the
 * file named, so a song you have shaped comes back the way you left it and a
 * song you have never touched arrives the way it was last shaped by anyone. */
export function chooseVoicing(
  saved: readonly SavedVoicing[],
  viewerId: string | null,
  picked: string | null,
): SavedVoicing | null {
  const mine =
    viewerId === null
      ? null
      : (saved.find((entry) => entry.authorId === viewerId) ?? null);
  return (
    saved.find((entry) => entry.authorId === picked) ?? mine ?? saved[0] ?? null
  );
}

export function useSongVoicing(
  params: PlayerParams,
  viewerId: string | null,
): SongVoicingState {
  const [saved, setSaved] = useState<readonly SavedVoicing[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [edited, setEdited] = useState<SongVoicing | null>(null);
  const url = params.url;

  /** Counts the times the listener has said how the song should sound. A read
   * or a save started before one of those lands afterwards, and the hand is
   * always the later word. */
  const shaped = useRef(0);
  const viewer = useRef(viewerId);
  viewer.current = viewerId;

  const load = useCallback(async (): Promise<readonly SavedVoicing[]> => {
    const response = await fetch(
      `/api/voicings?url=${encodeURIComponent(url)}`,
    );
    if (!response.ok) {
      return [];
    }
    const reply: Reply = await response.json();
    return reply.voicings.map((entry) => ({
      ...entry,
      tracks: asVoicing(entry.tracks),
    }));
  }, [url]);

  useEffect(() => {
    let live = true;
    const at = shaped.current;
    setEdited(null);
    setPicked(null);
    setSaved([]);
    Promise.all([
      loadSongVoicing(url).catch(() => null),
      load().catch(() => []),
    ]).then(([kept, rows]) => {
      if (!live) {
        return;
      }
      setSaved(rows);
      if (kept === null || shaped.current !== at) {
        return;
      }
      const mine = rows.find((row) => row.authorId === viewer.current) ?? null;
      if (mine !== null && mine.updatedAt > kept.updatedAt) {
        void forgetSongVoicing(url).catch(() => {});
        return;
      }
      setEdited(asVoicing(kept.tracks));
    });
    return () => {
      live = false;
    };
  }, [load, url]);

  const chosen = chooseVoicing(saved, viewerId, picked);
  const settled = chosen?.tracks ?? noVoicing;
  const voicing = edited ?? settled;
  const dirty = edited !== null && !same(edited, settled);

  const base = useRef(voicing);
  base.current = voicing;

  const device = useDeviceVoicing(url);

  const change = useCallback(
    (track: number, next: Voicing) => {
      const merged = new Map(base.current);
      merged.set(track, clampVoicing(next, track));
      setEdited(merged);
      shaped.current += 1;
      device.write(asRecord(merged));
    },
    [device],
  );

  const adopt = useCallback(
    (authorId: string) => {
      setPicked(authorId);
      setEdited(null);
      shaped.current += 1;
      device.cancel();
      void forgetSongVoicing(url).catch(() => {});
    },
    [device, url],
  );

  /** An empty voicing is a choice: it asks for the file's own instruments,
   * where a song this device has never shaped falls back to whoever shaped it
   * last. */
  const reset = useCallback(() => {
    setPicked(null);
    setEdited(new Map());
    shaped.current += 1;
    device.cancel();
    device.write({});
  }, [device]);

  const save = useCallback(async () => {
    const at = shaped.current;
    const response = await fetch("/api/voicings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, tracks: asRecord(base.current) }),
    });
    if (!response.ok) {
      return;
    }
    device.cancel();
    await forgetSongVoicing(url).catch(() => {});
    const rows = await load();
    setSaved(rows);
    // A round trip is long enough to shape the song again in, and that edit is
    // the one on screen and on this device.
    if (shaped.current === at) {
      setEdited(null);
      setPicked(null);
    }
  }, [device, url, load]);

  return {
    voicing,
    saved,
    playing: dirty ? "" : (chosen?.authorName ?? ""),
    dirty,
    change,
    adopt,
    reset,
    save,
  };
}
