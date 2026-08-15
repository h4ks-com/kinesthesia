import type { SheetNote } from "@/lib/sheet/types";

export type StaffSplit = {
  readonly treble: readonly SheetNote[];
  readonly bass: readonly SheetNote[];
};

/** Splits notes across the grand staff by the song's own pitch distribution
 * rather than a fixed line, so a piece that sits entirely high or low still
 * lands mostly on one staff instead of straddling middle C by convention. A
 * real two-hand split needs the shape of the melody as well as its pitches,
 * which is what the dedicated hand-separation work covers; this is a
 * self-contained placeholder for it. */
export function splitStaves(notes: readonly SheetNote[]): StaffSplit {
  if (notes.length === 0) {
    return { treble: [], bass: [] };
  }
  const pitches = notes
    .map((note) => note.pitch)
    .sort((left, right) => left - right);
  const middle = Math.floor(pitches.length / 2);
  const median =
    pitches.length % 2 === 0
      ? ((pitches[middle - 1] ?? 0) + (pitches[middle] ?? 0)) / 2
      : (pitches[middle] ?? 0);
  return {
    treble: notes.filter((note) => note.pitch >= median),
    bass: notes.filter((note) => note.pitch < median),
  };
}
