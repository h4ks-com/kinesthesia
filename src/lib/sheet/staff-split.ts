import { assignHandsForSong } from "@/lib/midi/hands";
import type { StaffClef } from "@/lib/sheet/notation";
import type { SheetNote } from "@/lib/sheet/types";

export type StaffSplit = {
  readonly treble: readonly SheetNote[];
  readonly bass: readonly SheetNote[];
};

/** Middle C, the note the two staves of a grand staff meet at. */
const middleC = 60;

/** How far one hand reaches, which is what decides whether a part needs the
 * second staff at all. A tenth is comfortable and a wider stretch is not. */
const handReach = 16;

/**
 * Which staff a note is written on is the same question as which hand plays it,
 * so the grand staff is drawn from the split the player already works out: a
 * left hand reaching above middle C stays on the bass staff rather than jumping
 * across at a fixed line.
 *
 * A part played by one hand is a different question, and the split cannot
 * answer it: it weighs notes only against each other, so it would divide a line
 * that never leaves the treble. A part inside one hand's reach goes on the one
 * staff its register puts it on.
 */
/** Which clef a line of music reads best in, from where it sits rather than
 * from what the instrument is called: a bass line named for its patch is still
 * a bass line when the patch is missing. */
export function clefFor(notes: readonly SheetNote[]): StaffClef {
  if (notes.length === 0) {
    return "treble";
  }
  return median(notes.map((note) => note.pitch)) >= middleC ? "treble" : "bass";
}

export function splitStaves(notes: readonly SheetNote[]): StaffSplit {
  if (notes.length === 0) {
    return { treble: [], bass: [] };
  }
  const pitches = notes.map((note) => note.pitch);
  if (Math.max(...pitches) - Math.min(...pitches) <= handReach) {
    return clefFor(notes) === "treble"
      ? { treble: notes, bass: [] }
      : { treble: [], bass: notes };
  }
  const hands = assignHandsForSong(
    notes.map((note, id) => ({
      id,
      pitch: note.pitch,
      start: note.start,
      track: 0,
    })),
  );
  const treble: SheetNote[] = [];
  const bass: SheetNote[] = [];
  notes.forEach((note, id) => {
    if (hands.get(id) === "left") {
      bass.push(note);
    } else {
      treble.push(note);
    }
  });
  return { treble, bass };
}

function median(pitches: readonly number[]): number {
  const sorted = [...pitches].sort((one, next) => one - next);
  return sorted[Math.floor(sorted.length / 2)] ?? middleC;
}
