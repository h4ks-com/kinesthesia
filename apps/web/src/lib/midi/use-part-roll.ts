"use client";

import { useCallback, useMemo } from "react";
import { medianPitch, type Part, partLine } from "@/lib/midi/part";
import type { Song, SongNote } from "@/lib/midi/song";

const emptyPitches: ReadonlySet<number> = new Set();

export type PartRoll = {
  getYours: () => ReadonlySet<number> | null;
  getOwed: () => ReadonlySet<number>;
  /** How many notes the part asks for, so a tally can read as a share of it. */
  owedNotes: number;
  /** Where the part sits on the keyboard, so a roll opens on the notes rather
   * than the lowest keys and both sides of a match frame the same stretch. */
  focusPitch: number | null;
};

/** Turns a side's part into what the roll draws it with: its lit line, and
 * nothing owed, since we never know another side's pending notes. What their
 * hands are doing comes off the wire, not from the part. */
export function usePartRoll(song: Song, part: Part | null): PartRoll {
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
    owedNotes: line.length,
    focusPitch,
  };
}
