import { describe, expect, it } from "vitest";
import { splitStaves } from "@/lib/sheet/staff-split";
import type { SheetNote } from "@/lib/sheet/types";

function noteAt(pitch: number): SheetNote {
  return { pitch, start: 0, duration: 1 };
}

describe("splitStaves", () => {
  it("returns nothing for an empty song", () => {
    expect(splitStaves([])).toEqual({ treble: [], bass: [] });
  });

  it("splits a wide chord around its own median rather than middle C", () => {
    // Every note sits well above middle C: a fixed middle-C split would put
    // everything in the treble, but the distribution's own median still
    // divides it into two groups.
    const notes = [72, 74, 76, 79, 81, 84].map(noteAt);
    const { treble, bass } = splitStaves(notes);
    expect(treble.length).toBeGreaterThan(0);
    expect(bass.length).toBeGreaterThan(0);
    expect(
      Math.min(...treble.map((note) => note.pitch)),
    ).toBeGreaterThanOrEqual(Math.max(...bass.map((note) => note.pitch)));
  });

  it("keeps a single pitch in the treble", () => {
    const { treble, bass } = splitStaves([noteAt(60)]);
    expect(treble).toHaveLength(1);
    expect(bass).toHaveLength(0);
  });
});
