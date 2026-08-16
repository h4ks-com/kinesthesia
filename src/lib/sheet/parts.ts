import type { SheetNote, SheetPart } from "@/lib/sheet/types";

export type PartNote = SheetNote & { readonly track: number };

export type PartTrack = {
  readonly index: number;
  readonly name: string;
  readonly percussion: boolean;
};

/** How many lines a score may carry. Past this a page is a wall of staves
 * nobody reads, and the busiest instruments are the ones worth the room. */
const maxParts = 10;

export type PartsInput = {
  readonly tracks: readonly PartTrack[];
  readonly notes: readonly PartNote[];
};

/**
 * Which lines the score is written on.
 *
 * A channel is an instrument, so a song carrying several of them is read the
 * way a score is: one line each, no hands to divide because no one player has
 * them all. A song on one channel is a keyboard part, and there the two staves
 * are the two hands.
 *
 * The caller decides what belongs here at all, which is how muting a track and
 * practising one hand reach the page: the notes handed over are already the
 * ones that matter.
 */
export function sheetParts(input: PartsInput): SheetPart[] {
  const pitched = new Set(
    input.tracks
      .filter((track) => !track.percussion)
      .map((track) => track.index),
  );
  const heard = input.notes.filter((note) => pitched.has(note.track));
  if (heard.length === 0) {
    return [];
  }

  const byTrack = new Map<number, SheetNote[]>();
  for (const note of heard) {
    const kept = byTrack.get(note.track) ?? [];
    kept.push({
      id: note.id,
      pitch: note.pitch,
      start: note.start,
      duration: note.duration,
    });
    byTrack.set(note.track, kept);
  }

  // A page of more lines than this is unreadable however tall the paper is,
  // so the quietest instruments give up their staff first.
  const playing = [...byTrack.keys()].sort((left, right) => left - right);
  const sounding =
    playing.length <= maxParts
      ? playing
      : [...playing]
          .sort(
            (left, right) =>
              (byTrack.get(right)?.length ?? 0) -
              (byTrack.get(left)?.length ?? 0),
          )
          .slice(0, maxParts)
          .sort((left, right) => left - right);
  const nameOf = new Map(
    input.tracks.map((track) => [track.index, track.name]),
  );
  return sounding.map((index) => ({
    name: nameOf.get(index)?.trim() || `Part ${index + 1}`,
    notes: byTrack.get(index) ?? [],
    split: sounding.length === 1,
  }));
}
