import { describe, expect, it } from "vitest";
import {
  buildInstructions,
  decomposeDuration,
  divisions,
  fillGaps,
  quantizeNotes,
  separateVoices,
  voiceNumber,
  voicesPerStaff,
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
    const instructions = buildInstructions(events, 16, 1, 2);
    expect(instructions).toEqual([
      {
        measureIndex: 0,
        positionInMeasure: 14,
        tones: [{ pitch: 60, ids: [9] }],
        durationUnits: 2,
        tieStart: true,
        tieStop: false,
        staff: 1,
        voice: 2,
      },
      {
        measureIndex: 1,
        positionInMeasure: 0,
        tones: [{ pitch: 60, ids: [9] }],
        durationUnits: 2,
        tieStart: false,
        tieStop: true,
        staff: 1,
        voice: 2,
      },
    ]);
  });

  it("never ties a rest", () => {
    const events = [{ start: 14, duration: 4, tones: [] }];
    const instructions = buildInstructions(events, 16, 2, 5);
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
    const instructions = buildInstructions(events, 16, 1, 1);
    expect(
      instructions.map((instruction) => instruction.durationUnits),
    ).toEqual([4, 1]);
    expect(instructions[0]?.positionInMeasure).toBe(0);
    expect(instructions[1]?.positionInMeasure).toBe(4);
    expect(instructions[0]?.tieStart).toBe(true);
    expect(instructions[1]?.tieStop).toBe(true);
  });
});
