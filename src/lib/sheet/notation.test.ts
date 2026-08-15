import { describe, expect, it } from "vitest";
import {
  buildInstructions,
  decomposeDuration,
  divisions,
  quantizeNotes,
  sequenceStaff,
} from "@/lib/sheet/notation";

describe("quantizeNotes", () => {
  it("converts seconds to 16th-note units at the given tempo", () => {
    // 120bpm: one quarter note is 0.5s, one 16th is 0.125s.
    const [note] = quantizeNotes(
      [{ pitch: 60, start: 0.5, duration: 0.125 }],
      120,
    );
    expect(note).toEqual({ pitch: 60, start: 4, duration: 1 });
  });

  it("never quantizes a real note down to zero duration", () => {
    const [note] = quantizeNotes(
      [{ pitch: 60, start: 0, duration: 0.001 }],
      120,
    );
    expect(note?.duration).toBeGreaterThan(0);
  });
});

describe("sequenceStaff", () => {
  it("fills a silent staff with one rest covering the whole span", () => {
    expect(sequenceStaff([], 16)).toEqual([
      { start: 0, duration: 16, pitches: [] },
    ]);
  });

  it("inserts a rest before the first note", () => {
    const events = sequenceStaff([{ pitch: 60, start: 4, duration: 4 }], 16);
    expect(events[0]).toEqual({ start: 0, duration: 4, pitches: [] });
    expect(events[1]).toEqual({ start: 4, duration: 4, pitches: [60] });
    expect(events[2]).toEqual({ start: 8, duration: 8, pitches: [] });
  });

  it("stacks simultaneous notes into one chord at the shortest duration", () => {
    const events = sequenceStaff(
      [
        { pitch: 60, start: 0, duration: 8 },
        { pitch: 64, start: 0, duration: 4 },
        { pitch: 67, start: 0, duration: 4 },
      ],
      16,
    );
    expect(events[0]).toEqual({ start: 0, duration: 4, pitches: [67, 64, 60] });
  });

  it("clips a note that overlaps one already sounding", () => {
    const events = sequenceStaff(
      [
        { pitch: 60, start: 0, duration: 8 },
        { pitch: 64, start: 4, duration: 8 },
      ],
      16,
    );
    expect(events[0]).toEqual({ start: 0, duration: 8, pitches: [60] });
    expect(events[1]).toEqual({ start: 8, duration: 4, pitches: [64] });
  });

  it("drops a note fully swallowed by one already sounding", () => {
    const events = sequenceStaff(
      [
        { pitch: 60, start: 0, duration: 16 },
        { pitch: 64, start: 2, duration: 2 },
      ],
      16,
    );
    expect(events).toEqual([{ start: 0, duration: 16, pitches: [60] }]);
  });
});

describe("decomposeDuration", () => {
  it("uses a single value when one exists", () => {
    expect(decomposeDuration(divisions)).toEqual([4]);
    expect(decomposeDuration(16)).toEqual([16]);
  });

  it("greedily breaks an odd duration into standard values", () => {
    expect(decomposeDuration(5)).toEqual([4, 1]);
    expect(decomposeDuration(7)).toEqual([6, 1]);
  });

  it("never returns an empty list for a positive duration", () => {
    expect(decomposeDuration(1).length).toBeGreaterThan(0);
  });
});

describe("buildInstructions", () => {
  it("ties a note split across a measure boundary", () => {
    const events = [{ start: 14, duration: 4, pitches: [60] }];
    const instructions = buildInstructions(events, 16, 1);
    expect(instructions).toEqual([
      {
        measureIndex: 0,
        pitches: [60],
        durationUnits: 2,
        tieStart: true,
        tieStop: false,
        staff: 1,
      },
      {
        measureIndex: 1,
        pitches: [60],
        durationUnits: 2,
        tieStart: false,
        tieStop: true,
        staff: 1,
      },
    ]);
  });

  it("never ties a rest", () => {
    const events = [{ start: 14, duration: 4, pitches: [] }];
    const instructions = buildInstructions(events, 16, 2);
    expect(
      instructions.every(
        (instruction) => !instruction.tieStart && !instruction.tieStop,
      ),
    ).toBe(true);
  });

  it("ties every chunk of a duration too long for one note value", () => {
    const events = [{ start: 0, duration: 5, pitches: [60] }];
    const instructions = buildInstructions(events, 16, 1);
    expect(
      instructions.map((instruction) => instruction.durationUnits),
    ).toEqual([4, 1]);
    expect(instructions[0]?.tieStart).toBe(true);
    expect(instructions[1]?.tieStop).toBe(true);
  });
});
