import { describe, expect, it } from "vitest";
import { splitStaves } from "@/lib/sheet/staff-split";
import type { SheetNote } from "@/lib/sheet/types";

let nextId = 0;

function noteAt(pitch: number, start = 0, duration = 1): SheetNote {
  nextId += 1;
  return { id: nextId, pitch, start, duration };
}

describe("splitStaves", () => {
  it("returns nothing for an empty song", () => {
    expect(splitStaves([])).toEqual({ treble: [], bass: [] });
  });

  it("splits a wide chord so neither staff spans more than a hand", () => {
    const notes = [48, 55, 64, 67, 72, 76].map((pitch) => noteAt(pitch));

    const { treble, bass } = splitStaves(notes);

    expect(treble.length).toBeGreaterThan(0);
    expect(bass.length).toBeGreaterThan(0);
    expect(Math.min(...treble.map((note) => note.pitch))).toBeGreaterThan(
      Math.max(...bass.map((note) => note.pitch)),
    );
  });

  it("keeps a single pitch on one staff", () => {
    const { treble, bass } = splitStaves([noteAt(60)]);
    expect(treble.length + bass.length).toBe(1);
  });

  // A pitch line on its own reads a part that never leaves the treble as two
  // hands, because it divides whatever it is given at the middle.
  it("leaves a part that sits high entirely on the treble staff", () => {
    const high = [72, 74, 76, 79, 81, 84, 76, 79].map((pitch, at) =>
      noteAt(pitch, at * 0.5),
    );

    const { treble, bass } = splitStaves(high);

    expect(bass).toHaveLength(0);
    expect(treble).toHaveLength(high.length);
  });

  // The left hand crosses above middle C here, which is exactly what a fixed
  // line, or a median over the whole song, gets wrong.
  it("keeps a left hand reaching above middle C on the bass staff", () => {
    const notes: SheetNote[] = [];
    for (let beat = 0; beat < 8; beat += 1) {
      notes.push(noteAt(beat % 2 === 0 ? 48 : 64, beat * 0.5));
      notes.push(noteAt(84, beat * 0.5));
    }

    const { bass } = splitStaves(notes);

    expect(bass.some((note) => note.pitch === 64)).toBe(true);
  });

  // A melody's own ends can sit further apart than a hand reaches without any
  // single moment of it ever asking for a second hand: judging the part by
  // its own overall span, rather than by what is actually struck together,
  // used to fabricate a second hand for a line that never leaves the first.
  it("keeps a wide-ranging single line on one staff instead of inventing a second hand", () => {
    const melody = [50, 55, 60, 65, 70, 75, 80, 74, 68, 62].map((pitch, at) =>
      noteAt(pitch, at * 0.5),
    );

    const { treble, bass } = splitStaves(melody);

    expect(bass).toHaveLength(0);
    expect(treble).toHaveLength(melody.length);
  });

  // The song's own median leans on the tenor register this line repeats, not
  // on where the line as a whole actually sits, which is exactly the case
  // Debussy's Clair de Lune left hand puts on the treble staff if the split
  // reads the note count rather than the range.
  it("puts a one-handed part that mostly repeats above middle C, but reaches well below it, on the bass staff", () => {
    const notes: SheetNote[] = [];
    for (let at = 0; at < 20; at += 1) {
      notes.push(noteAt(61, at * 0.5));
    }
    notes.push(noteAt(27, 20 * 0.5));

    const { treble, bass } = splitStaves(notes);

    expect(treble).toHaveLength(0);
    expect(bass).toHaveLength(notes.length);
  });
});
