import { describe, expect, it } from "vitest";
import { keySpelling, spellPitch } from "@/lib/sheet/spelling";

describe("keySpelling", () => {
  it("spells every diatonic pitch class of C major with no accidental", () => {
    const { table, fifths } = keySpelling("C", "major");
    expect(fifths).toBe(0);
    expect(spellPitch(60, table)).toEqual({ step: "C", alter: 0, octave: 4 });
    expect(spellPitch(62, table)).toEqual({ step: "D", alter: 0, octave: 4 });
    expect(spellPitch(64, table)).toEqual({ step: "E", alter: 0, octave: 4 });
    expect(spellPitch(65, table)).toEqual({ step: "F", alter: 0, octave: 4 });
    expect(spellPitch(67, table)).toEqual({ step: "G", alter: 0, octave: 4 });
    expect(spellPitch(69, table)).toEqual({ step: "A", alter: 0, octave: 4 });
    expect(spellPitch(71, table)).toEqual({ step: "B", alter: 0, octave: 4 });
  });

  it("spells C major's chromatic notes as sharps", () => {
    const { table } = keySpelling("C", "major");
    expect(spellPitch(61, table)).toEqual({ step: "C", alter: 1, octave: 4 });
    expect(spellPitch(66, table)).toEqual({ step: "F", alter: 1, octave: 4 });
  });

  it("spells F major's Bb as a diatonic flat, not a chromatic sharp", () => {
    const { table, fifths } = keySpelling("F", "major");
    expect(fifths).toBe(-1);
    expect(spellPitch(70, table)).toEqual({ step: "B", alter: -1, octave: 4 });
  });

  it("spells F major's chromatic notes as flats", () => {
    const { table } = keySpelling("F", "major");
    // The chromatic pitch class between F and G is spelled as a flat
    // borrowed from the diatonic note above, rather than as F sharp.
    expect(spellPitch(66, table)).toEqual({ step: "G", alter: -1, octave: 4 });
  });

  it("gives G major a sharp signature", () => {
    const { fifths } = keySpelling("G", "major");
    expect(fifths).toBe(1);
  });

  it("spells A minor the same as its relative major", () => {
    const { table, fifths } = keySpelling("A", "minor");
    expect(fifths).toBe(0);
    expect(spellPitch(60, table)).toEqual({ step: "C", alter: 0, octave: 4 });
    expect(spellPitch(69, table)).toEqual({ step: "A", alter: 0, octave: 4 });
  });

  it("crosses octave boundaries at C", () => {
    const { table } = keySpelling("C", "major");
    expect(spellPitch(59, table).octave).toBe(3);
    expect(spellPitch(60, table).octave).toBe(4);
  });
});
