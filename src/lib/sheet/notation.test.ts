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
      [{ id: 7, pitch: 60, start: 0.5, duration: 0.125 }],
      120,
    );
    expect(note).toEqual({ id: 7, pitch: 60, start: 4, duration: 1 });
  });

  it("never quantizes a real note down to zero duration", () => {
    const [note] = quantizeNotes(
      [{ id: 1, pitch: 60, start: 0, duration: 0.001 }],
      120,
    );
    expect(note?.duration).toBeGreaterThan(0);
  });
});

describe("sequenceStaff", () => {
  it("fills a silent staff with one rest covering the whole span", () => {
    expect(sequenceStaff([], 16)).toEqual([
      { start: 0, duration: 16, tones: [] },
    ]);
  });

  it("inserts a rest before the first note", () => {
    const events = sequenceStaff(
      [{ id: 1, pitch: 60, start: 4, duration: 4 }],
      16,
    );
    expect(events[0]).toEqual({ start: 0, duration: 4, tones: [] });
    expect(events[1]).toEqual({
      start: 4,
      duration: 4,
      tones: [{ pitch: 60, ids: [1] }],
    });
    expect(events[2]).toEqual({ start: 8, duration: 8, tones: [] });
  });

  it("stacks simultaneous notes into one chord at the shortest duration", () => {
    const events = sequenceStaff(
      [
        { id: 1, pitch: 60, start: 0, duration: 8 },
        { id: 2, pitch: 64, start: 0, duration: 4 },
        { id: 3, pitch: 67, start: 0, duration: 4 },
      ],
      16,
    );
    expect(events[0]).toEqual({
      start: 0,
      duration: 4,
      tones: [
        { pitch: 67, ids: [3] },
        { pitch: 64, ids: [2] },
        { pitch: 60, ids: [1] },
      ],
    });
  });

  it("writes a note struck while another is still sounding", () => {
    const events = sequenceStaff(
      [
        { id: 1, pitch: 60, start: 0, duration: 8 },
        { id: 2, pitch: 64, start: 4, duration: 8 },
      ],
      16,
    );

    expect(events[0]).toEqual({
      start: 0,
      duration: 4,
      tones: [{ pitch: 60, ids: [1] }],
    });
    expect(events[1]).toEqual({
      start: 4,
      duration: 4,
      tones: [
        { pitch: 64, ids: [2] },
        { pitch: 60, ids: [1] },
      ],
    });
    expect(events[2]?.tones).toEqual([{ pitch: 64, ids: [2] }]);
  });

  it("keeps a note wholly inside another rather than losing it", () => {
    const events = sequenceStaff(
      [
        { id: 1, pitch: 60, start: 0, duration: 16 },
        { id: 2, pitch: 64, start: 2, duration: 2 },
      ],
      16,
    );

    const heard = events.find((event) =>
      event.tones.some((tone) => tone.pitch === 64),
    );
    expect(heard?.start).toBe(2);
    expect(heard?.tones.map((tone) => tone.pitch)).toContain(60);
  });

  it("collects every source id sounding at the same written pitch", () => {
    const events = sequenceStaff(
      [
        { id: 1, pitch: 60, start: 0, duration: 4 },
        { id: 2, pitch: 60, start: 0, duration: 4 },
      ],
      16,
    );
    expect(events[0]?.tones).toEqual([{ pitch: 60, ids: [1, 2] }]);
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
    const events = [
      { start: 14, duration: 4, tones: [{ pitch: 60, ids: [9] }] },
    ];
    const instructions = buildInstructions(events, 16, 1);
    expect(instructions).toEqual([
      {
        measureIndex: 0,
        positionInMeasure: 14,
        tones: [{ pitch: 60, ids: [9] }],
        durationUnits: 2,
        tieStart: true,
        tieStop: false,
        staff: 1,
      },
      {
        measureIndex: 1,
        positionInMeasure: 0,
        tones: [{ pitch: 60, ids: [9] }],
        durationUnits: 2,
        tieStart: false,
        tieStop: true,
        staff: 1,
      },
    ]);
  });

  it("never ties a rest", () => {
    const events = [{ start: 14, duration: 4, tones: [] }];
    const instructions = buildInstructions(events, 16, 2);
    expect(
      instructions.every(
        (instruction) => !instruction.tieStart && !instruction.tieStop,
      ),
    ).toBe(true);
  });

  it("ties every chunk of a duration too long for one note value", () => {
    const events = [
      { start: 0, duration: 5, tones: [{ pitch: 60, ids: [9] }] },
    ];
    const instructions = buildInstructions(events, 16, 1);
    expect(
      instructions.map((instruction) => instruction.durationUnits),
    ).toEqual([4, 1]);
    expect(instructions[0]?.positionInMeasure).toBe(0);
    expect(instructions[1]?.positionInMeasure).toBe(4);
    expect(instructions[0]?.tieStart).toBe(true);
    expect(instructions[1]?.tieStop).toBe(true);
  });
});
