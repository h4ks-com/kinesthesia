import {
  assignHandsForSong,
  groupChords,
  type PlacedNote,
} from "@/lib/midi/hands";
import type { StaffClef } from "@/lib/sheet/notation";
import type { SheetNote } from "@/lib/sheet/types";

export type StaffSplit = {
  readonly treble: readonly SheetNote[];
  readonly bass: readonly SheetNote[];
};

/** How much of each end of a part's range a clef choice ignores. A lone pedal
 * note is not where a line lives, and neither is the pitch it happens to
 * repeat most, so the decision reads the span with both ends trimmed. */
const clefTrim = 0.1;

/** Middle C, the note the two staves of a grand staff meet at. */
const middleC = 60;

/** How far one hand reaches. A tenth is comfortable and a wider stretch is
 * not, so a chord no wider than this is one hand's to play, never two. */
const handReach = 16;

/** Which clef a line of music reads best in, from where it sits rather than
 * from what the instrument is called: a bass line named for its patch is still
 * a bass line when the patch is missing.
 *
 * Read off the middle of the span the line actually occupies. How often a
 * pitch repeats says where a line rests, not where it lives, and the bare
 * extremes hand the answer to a single pedal note. */
export function clefFor(notes: readonly SheetNote[]): StaffClef {
  if (notes.length === 0) {
    return "treble";
  }
  const sorted = [...notes.map((note) => note.pitch)].sort(
    (left, right) => left - right,
  );
  const low = sorted[Math.floor((sorted.length - 1) * clefTrim)] ?? middleC;
  const high = sorted[Math.ceil((sorted.length - 1) * (1 - clefTrim))] ?? low;
  return (low + high) / 2 >= middleC ? "treble" : "bass";
}

function widestChord(placed: readonly PlacedNote[]): number {
  const sorted = [...placed].sort(
    (left, right) => left.start - right.start || left.pitch - right.pitch,
  );
  let widest = 0;
  for (const chord of groupChords(sorted)) {
    const pitches = chord.map((note) => note.pitch);
    widest = Math.max(widest, Math.max(...pitches) - Math.min(...pitches));
  }
  return widest;
}

/**
 * Which staff a note is written on is the same question as which hand plays it,
 * so the grand staff is drawn from the split the player already works out: a
 * left hand reaching above middle C stays on the bass staff rather than jumping
 * across at a fixed line.
 *
 * A part played by one hand is a different question, and the split cannot
 * answer it: it weighs notes only against each other, so it would divide a line
 * that never leaves the treble. Whether that question even arises is asked of
 * the music one chord at a time, not of the part's ends: a melody can range
 * across four octaves over its own length and still never ask two hands to
 * play at once, which is exactly what a part's overall span cannot tell apart
 * from a chord that genuinely does.
 */
export function splitStaves(notes: readonly SheetNote[]): StaffSplit {
  if (notes.length === 0) {
    return { treble: [], bass: [] };
  }
  const placed = notes.map((note, id) => ({
    id,
    pitch: note.pitch,
    start: note.start,
    track: 0,
  }));
  if (widestChord(placed) <= handReach) {
    return clefFor(notes) === "treble"
      ? { treble: notes, bass: [] }
      : { treble: [], bass: notes };
  }
  const hands = assignHandsForSong(placed);
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
