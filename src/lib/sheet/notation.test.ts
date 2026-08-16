import { describe, expect, it } from "vitest";
import {
  beatSteps,
  buildInstructions,
  decomposeDuration,
  divisions,
  fillGaps,
  type Grid,
  meterGrid,
  type QuantizedNote,
  quantizeNotes,
  separateVoices,
  voiceNumber,
  voicesPerStaff,
} from "@/lib/sheet/notation";
import type { SheetNote } from "@/lib/sheet/types";

const common = meterGrid(4, 4);
const compound = meterGrid(9, 8);

/** 120bpm: one quarter note is 0.5s. */
function quantize(
  notes: readonly SheetNote[],
  grid: Grid = common,
): QuantizedNote[] {
  return quantizeNotes(notes, beatSteps(notes, 120, grid));
}

/** Sixteenths through one beat, which is the evidence that makes the
 * quantiser pick a sixteenth grid for it. */
function sixteenthsFrom(start: number, count: number): SheetNote[] {
  return Array.from({ length: count }, (_one, index) => ({
    id: index + 1,
    pitch: 60 + index,
    start: start + index * 0.125,
    duration: 0.125,
  }));
}

describe("the notation grid", () => {
  it("writes an eighth-note triplet exactly", () => {
    expect((divisions / 3) % 1).toBe(0);
  });

  it("writes a 32nd note exactly", () => {
    expect((divisions / 8) % 1).toBe(0);
  });

  it("reads 9/8 in dotted-quarter beats and 4/4 in quarters", () => {
    expect(compound.beatUnits).toBe(divisions * 1.5);
    expect(compound.measureUnits).toBe(divisions * 4.5);
    expect(common.beatUnits).toBe(divisions);
    expect(common.measureUnits).toBe(divisions * 4);
  });

  it("falls back to 4/4 for a meter nobody wrote", () => {
    expect(meterGrid(0, 0)).toEqual(common);
  });
});

describe("quantizeNotes", () => {
  it("converts seconds to grid units at the given tempo", () => {
    const [note] = quantize(sixteenthsFrom(0.5, 4));
    expect(note?.start).toBe(divisions);
    expect(note?.duration).toBe(divisions / 4);
  });

  it("keeps a chord's spread attacks on one written position", () => {
    const spread = quantize([
      { id: 1, pitch: 60, start: 0.0, duration: 0.5 },
      { id: 2, pitch: 64, start: 0.02, duration: 0.5 },
      { id: 3, pitch: 67, start: 0.04, duration: 0.5 },
    ]);
    expect(spread.map((note) => note.start)).toEqual([0, 0, 0]);
  });

  it("keeps a beat of real sixteenths apart", () => {
    const run = quantize(sixteenthsFrom(0, 4));
    expect(run.map((note) => note.start)).toEqual([
      0,
      divisions / 4,
      divisions / 2,
      (divisions * 3) / 4,
    ]);
  });

  it("never quantizes a real note down to zero duration", () => {
    const [note] = quantize([{ id: 1, pitch: 60, start: 0, duration: 0.001 }]);
    expect(note?.duration).toBeGreaterThan(0);
  });
});

describe("separateVoices", () => {
  it("gives a silent staff one empty voice", () => {
    expect(separateVoices([])).toEqual([[]]);
  });

  it("writes a note held under a moving line once, at its real length", () => {
    const [held, moving] = separateVoices([
      { id: 1, pitch: 70, start: 0, duration: 16 },
      { id: 2, pitch: 60, start: 0, duration: 4 },
      { id: 3, pitch: 62, start: 4, duration: 4 },
      { id: 4, pitch: 64, start: 8, duration: 8 },
    ]);

    expect(held).toEqual([
      { start: 0, duration: 16, tones: [{ pitch: 70, ids: [1] }] },
    ]);
    expect(moving?.map((event) => event.start)).toEqual([0, 4, 8]);
  });

  it("keeps a chord struck and released together in one voice", () => {
    const voices = separateVoices([
      { id: 1, pitch: 60, start: 0, duration: 4 },
      { id: 2, pitch: 64, start: 0, duration: 4 },
      { id: 3, pitch: 67, start: 0, duration: 4 },
    ]);

    expect(voices).toHaveLength(1);
    expect(voices[0]?.[0]?.tones).toEqual([
      { pitch: 67, ids: [3] },
      { pitch: 64, ids: [2] },
      { pitch: 60, ids: [1] },
    ]);
  });

  it("collects every source id sounding at the same written pitch", () => {
    const voices = separateVoices([
      { id: 1, pitch: 60, start: 0, duration: 4 },
      { id: 2, pitch: 60, start: 0, duration: 4 },
    ]);
    expect(voices[0]?.[0]?.tones).toEqual([{ pitch: 60, ids: [1, 2] }]);
  });

  it("reuses a voice once its note has ended", () => {
    const voices = separateVoices([
      { id: 1, pitch: 60, start: 0, duration: 4 },
      { id: 2, pitch: 62, start: 4, duration: 4 },
    ]);
    expect(voices).toHaveLength(1);
    expect(voices[0]).toHaveLength(2);
  });

  it("puts the higher line in the first voice", () => {
    const [upper, lower] = separateVoices([
      { id: 1, pitch: 48, start: 0, duration: 8 },
      { id: 2, pitch: 72, start: 0, duration: 16 },
    ]);
    expect(upper?.[0]?.tones[0]?.pitch).toBe(72);
    expect(lower?.[0]?.tones[0]?.pitch).toBe(48);
  });

  it("prefers the voice whose last pitch is nearest", () => {
    const voices = separateVoices([
      { id: 1, pitch: 84, start: 0, duration: 4 },
      { id: 2, pitch: 48, start: 0, duration: 8 },
      { id: 3, pitch: 50, start: 8, duration: 4 },
    ]);
    expect(voices[1]?.map((event) => event.tones[0]?.pitch)).toEqual([48, 50]);
  });

  it("never opens more voices than a staff carries", () => {
    const notes = Array.from({ length: voicesPerStaff + 3 }, (_one, index) => ({
      id: index + 1,
      pitch: 40 + index * 3,
      start: index,
      duration: 64,
    }));
    const voices = separateVoices(notes);
    expect(voices).toHaveLength(voicesPerStaff);
    const written = voices.flatMap((voice) =>
      voice.flatMap((event) => event.tones.flatMap((tone) => tone.ids)),
    );
    expect([...written].sort((left, right) => left - right)).toEqual(
      notes.map((note) => note.id),
    );
  });

  it("cuts a held note short rather than dropping the note past the cap", () => {
    const voices = separateVoices([
      ...Array.from({ length: voicesPerStaff }, (_one, index) => ({
        id: index + 1,
        pitch: 60 + index,
        start: 0,
        duration: 16 - index,
      })),
      { id: 99, pitch: 61, start: 8, duration: 8 },
    ]);
    const holder = voices.find((voice) =>
      voice.some((event) => event.tones.some((tone) => tone.ids.includes(99))),
    );
    const cut = holder?.[0];
    expect(cut?.duration).toBe(8);
    expect(holder?.[1]?.start).toBe(8);
  });

  it("keeps no two notes of one voice sounding at once", () => {
    const voices = separateVoices([
      { id: 1, pitch: 60, start: 0, duration: 16 },
      { id: 2, pitch: 64, start: 2, duration: 2 },
      { id: 3, pitch: 67, start: 3, duration: 9 },
      { id: 4, pitch: 72, start: 3, duration: 4 },
    ]);
    for (const voice of voices) {
      voice.forEach((event, index) => {
        const next = voice[index + 1];
        if (next !== undefined) {
          expect(event.start + event.duration).toBeLessThanOrEqual(next.start);
        }
      });
    }
  });
});

describe("fillGaps", () => {
  it("covers a silent voice with one rest", () => {
    expect(fillGaps([], 16)).toEqual([{ start: 0, duration: 16, tones: [] }]);
  });

  it("rests before, between and after a voice's notes", () => {
    const filled = fillGaps(
      [
        { start: 4, duration: 4, tones: [{ pitch: 60, ids: [1] }] },
        { start: 12, duration: 2, tones: [{ pitch: 62, ids: [2] }] },
      ],
      16,
    );
    expect(filled.map((event) => [event.start, event.duration])).toEqual([
      [0, 4],
      [4, 4],
      [8, 4],
      [12, 2],
      [14, 2],
    ]);
  });
});

describe("voiceNumber", () => {
  it("numbers the second staff's voices after the first staff's", () => {
    expect(voiceNumber(1, 0)).toBe(1);
    expect(voiceNumber(2, 0)).toBe(voicesPerStaff + 1);
  });
});

describe("decomposeDuration", () => {
  it("writes one beat as one note in 4/4", () => {
    expect(decomposeDuration(0, common.beatUnits, common)).toEqual([divisions]);
  });

  it("writes one beat as one dotted quarter in 9/8", () => {
    expect(decomposeDuration(0, compound.beatUnits, compound)).toEqual([
      divisions * 1.5,
    ]);
  });

  it("writes a whole 4/4 measure as one note", () => {
    expect(decomposeDuration(0, common.measureUnits, common)).toEqual([
      divisions * 4,
    ]);
  });

  it("runs over whole beats only, from a beat, in 9/8", () => {
    expect(decomposeDuration(0, compound.measureUnits, compound)).toEqual([
      compound.beatUnits * 2,
      compound.beatUnits,
    ]);
  });

  it("stops a note that started inside a beat at the end of it", () => {
    const eighth = divisions / 2;
    expect(decomposeDuration(eighth, divisions, common)).toEqual([
      eighth,
      eighth,
    ]);
  });

  it("prefers a dotted value where one is exactly right", () => {
    expect(decomposeDuration(0, divisions * 3, common)).toEqual([
      divisions * 3,
    ]);
    expect(decomposeDuration(0, (divisions * 3) / 4, common)).toEqual([
      (divisions * 3) / 4,
    ]);
  });

  it("never returns an empty list for a positive duration", () => {
    expect(decomposeDuration(0, 1, common).length).toBeGreaterThan(0);
  });
});

describe("buildInstructions", () => {
  const held = [{ pitch: 60, ids: [9] }];

  it("ties a note split across a measure boundary", () => {
    const start = common.measureUnits - divisions / 2;
    const instructions = buildInstructions(
      [{ start, duration: divisions, tones: held }],
      common,
      1,
      2,
    );
    expect(
      instructions.map((one) => [one.measureIndex, one.positionInMeasure]),
    ).toEqual([
      [0, start],
      [1, 0],
    ]);
    expect(instructions[0]?.tieStart).toBe(true);
    expect(instructions[1]?.tieStop).toBe(true);
  });

  it("never ties a rest", () => {
    const instructions = buildInstructions(
      [{ start: common.measureUnits - 6, duration: divisions, tones: [] }],
      common,
      2,
      5,
    );
    expect(instructions.every((one) => !one.tieStart && !one.tieStop)).toBe(
      true,
    );
  });

  it("ties every chunk of a duration too long for one note value", () => {
    const instructions = buildInstructions(
      [{ start: 0, duration: divisions + divisions / 4, tones: held }],
      common,
      1,
      1,
    );
    expect(instructions.map((one) => one.durationUnits)).toEqual([
      divisions,
      divisions / 4,
    ]);
    expect(instructions[0]?.tieStart).toBe(true);
    expect(instructions[1]?.tieStop).toBe(true);
  });
});
