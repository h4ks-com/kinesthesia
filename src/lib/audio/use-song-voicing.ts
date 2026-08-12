"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  clampVoicing,
  type SongVoicing,
  type StoredVoicing,
  type Voicing,
} from "@/lib/audio/voicing";
import type { PlayerParams } from "@/lib/player-url";
import {
  forgetSongVoicing,
  loadSongVoicing,
  saveSongVoicing,
} from "@/lib/storage/settings";

/** Long enough that a hand still moving has not written yet, short enough that
 * a song left straight after an edit keeps it. */
const settleMs = 250;

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

function asVoicing(tracks: StoredVoicing): SongVoicing {
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

function asRecord(voicing: SongVoicing): StoredVoicing {
  return Object.fromEntries(
    [...voicing].map(([track, entry]) => [String(track), entry]),
  );
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
    ]).then(([device, rows]) => {
      if (!live) {
        return;
      }
      setSaved(rows);
      if (device === null || shaped.current !== at) {
        return;
      }
      const mine = rows.find((row) => row.authorId === viewer.current) ?? null;
      if (mine !== null && mine.updatedAt > device.updatedAt) {
        void forgetSongVoicing(url).catch(() => {});
        return;
      }
      setEdited(asVoicing(device.tracks));
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

  const pending = useRef<StoredVoicing | null>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = useCallback(() => {
    if (settle.current !== null) {
      clearTimeout(settle.current);
      settle.current = null;
    }
    pending.current = null;
  }, []);

  /** Under the url the edit was made on, since a song can be left before what
   * was shaped on it has settled. */
  const flush = useCallback(
    (target: string) => {
      const tracks = pending.current;
      cancel();
      if (tracks !== null) {
        void saveSongVoicing(target, tracks).catch(() => {});
      }
    },
    [cancel],
  );

  useEffect(() => () => flush(url), [flush, url]);

  /** Every edit is kept on this device, so a listener with no account keeps
   * what they shaped and a signed in one keeps it while it is still unsaved.
   *
   * The first is written at once, since picking an instrument and leaving is
   * one gesture. What follows within the window is held for the end of it:
   * dragging an envelope handle shapes the track on every pointer move, and
   * each write is a database transaction of its own. */
  const change = useCallback(
    (track: number, next: Voicing) => {
      const merged = new Map(base.current);
      merged.set(track, clampVoicing(next));
      setEdited(merged);
      shaped.current += 1;
      const tracks = asRecord(merged);
      if (settle.current !== null) {
        pending.current = tracks;
        return;
      }
      void saveSongVoicing(url, tracks).catch(() => {});
      settle.current = setTimeout(() => flush(url), settleMs);
    },
    [flush, url],
  );

  const adopt = useCallback(
    (authorId: string) => {
      setPicked(authorId);
      setEdited(null);
      shaped.current += 1;
      cancel();
      void forgetSongVoicing(url).catch(() => {});
    },
    [cancel, url],
  );

  /** An empty voicing is a choice: it asks for the file's own instruments,
   * where a song this device has never shaped falls back to whoever shaped it
   * last. */
  const reset = useCallback(() => {
    setPicked(null);
    setEdited(new Map());
    shaped.current += 1;
    cancel();
    void saveSongVoicing(url, {}).catch(() => {});
  }, [cancel, url]);

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
    cancel();
    await forgetSongVoicing(url).catch(() => {});
    const rows = await load();
    setSaved(rows);
    // A round trip is long enough to shape the song again in, and that edit is
    // the one on screen and on this device.
    if (shaped.current === at) {
      setEdited(null);
      setPicked(null);
    }
  }, [cancel, url, load]);

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
