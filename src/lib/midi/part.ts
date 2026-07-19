import { type MelodyRate, reduceToMelody } from "@/lib/midi/melody";
import type { Song, SongNote } from "@/lib/midi/song";

/** One player's share of a song: which tracks they owe, and whether that share
 * is reduced to a single line. Both sides of a match derive their roll from
 * this, so a co-op can hand each side a different one. */
export type Part = {
  readonly simplified: boolean;
  readonly melodyRate: MelodyRate;
  readonly tracks: readonly number[];
};

export function partLine(song: Song, part: Part): readonly SongNote[] {
  const tracks = new Set(part.tracks);
  return part.simplified
    ? reduceToMelody(song, { tracks, maxNotesPerSecond: part.melodyRate })
    : song.notes.filter((note) => tracks.has(note.track));
}

export function soundingPitches(
  notes: readonly SongNote[],
  position: number,
): ReadonlySet<number> {
  const pitches = new Set<number>();
  for (const note of notes) {
    if (note.start <= position && position < note.end) {
      pitches.add(note.pitch);
    }
  }
  return pitches;
}

/** Where a set of notes sits on the keyboard, so a roll opens on them instead
 * of the lowest keys. */
export function medianPitch(notes: readonly SongNote[]): number | null {
  const pitches = notes
    .map((note) => note.pitch)
    .sort((left, right) => left - right);
  return pitches[Math.floor(pitches.length / 2)] ?? null;
}

/** A side shows the line it owes and hides the rest, which is what makes both
 * halves of a match frame the same stretch. */
export function tracksToHide(
  song: Song,
  mine: ReadonlySet<number>,
): ReadonlySet<number> {
  return new Set(
    song.tracks.map((track) => track.index).filter((index) => !mine.has(index)),
  );
}

export function toggleHidden(
  current: ReadonlySet<number>,
  index: number,
): ReadonlySet<number> {
  const next = new Set(current);
  if (next.has(index)) {
    next.delete(index);
  } else {
    next.add(index);
  }
  return next;
}

/** Soloing twice puts everything back, so the same key both isolates a track
 * and restores the rest. */
export function soloHidden(
  all: readonly number[],
  current: ReadonlySet<number>,
  index: number,
): ReadonlySet<number> {
  const shown = all.filter((other) => !current.has(other));
  const already = shown.length === 1 && !current.has(index);
  return already ? new Set() : new Set(all.filter((other) => other !== index));
}
