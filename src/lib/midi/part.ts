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
