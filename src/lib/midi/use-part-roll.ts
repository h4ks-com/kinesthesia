"use client";

import { useCallback, useMemo } from "react";
import {
  medianPitch,
  type Part,
  partLine,
  soundingPitches,
} from "@/lib/midi/part";
import type { Song, SongNote } from "@/lib/midi/song";

const emptyPitches: ReadonlySet<number> = new Set();

export type PartRoll = {
  getYours: () => ReadonlySet<number> | null;
  getOwed: () => ReadonlySet<number>;
  getPressed: () => ReadonlySet<number>;
  /** Where the part sits on the keyboard, so a roll opens on the notes rather
   * than the lowest keys and both sides of a match frame the same stretch. */
  focusPitch: number | null;
};

/** Turns a side's part into the three getters the roll draws with: its lit
 * line, nothing owed (we never know another side's pending notes), and the keys
 * sounding right now off the given clock. */
export function usePartRoll(
  song: Song,
  part: Part | null,
  getPosition: () => number,
): PartRoll {
  const line = useMemo<readonly SongNote[]>(
    () => (part === null ? [] : partLine(song, part)),
    [song, part],
  );
  const yours = useMemo(
    () => (part === null ? null : new Set(line.map((note) => note.id))),
    [part, line],
  );
  const focusPitch = useMemo(
    () => medianPitch(line.length > 0 ? line : song.notes),
    [line, song],
  );
  return {
    getYours: useCallback(() => yours, [yours]),
    getOwed: useCallback(() => emptyPitches, []),
    getPressed: useCallback(
      () => soundingPitches(line, getPosition()),
      [line, getPosition],
    ),
    focusPitch,
  };
}
