import { describe, expect, it } from "vitest";
import {
  clampMelodyRate,
  type MelodyOptions,
  melodyRateRange,
  reduceToMelody,
} from "@/lib/midi/melody";
import type { Song, SongNote, SongTrack } from "@/lib/midi/song";

let nextId = 0;

function note(
  pitch: number,
  start: number,
  duration: number,
  track = 0,
): SongNote {
  nextId += 1;
  return {
    id: nextId,
    pitch,
    start,
    end: start + duration,
    velocity: 0.8,
    track,
  };
}

function track(index: number, percussion = false): SongTrack {
  return {
    index,
    name: `track ${index}`,
    instrument: "piano",
    program: 0,
    percussion,
    noteCount: 0,
  };
}

function song(notes: SongNote[], tracks: SongTrack[] = [track(0)]): Song {
  return {
    name: "test",
    duration: Math.max(0, ...notes.map((each) => each.end)),
    notes: [...notes].sort((left, right) => left.start - right.start),
    tracks,
  };
}

const generous: MelodyOptions = { tracks: new Set([0]), maxNotesPerSecond: 12 };

function overlaps(notes: readonly SongNote[]): boolean {
  return notes.some((each, index) => {
    const next = notes[index + 1];
    return next !== undefined && next.start < each.end;
  });
}

describe("reduceToMelody", () => {
  it("keeps only the top note of a chord", () => {
    const line = reduceToMelody(
      song([note(60, 0, 1), note(64, 0, 1), note(67, 0, 1)]),
      generous,
    );
    expect(line.map((each) => each.pitch)).toEqual([67]);
  });

  it("treats notes struck a hair apart as one chord", () => {
    const line = reduceToMelody(
      song([note(60, 0, 1), note(67, 0.02, 1), note(64, 0.04, 1)]),
      generous,
    );
    expect(line.map((each) => each.pitch)).toEqual([67]);
  });

  it("follows the top line as it moves", () => {
    const line = reduceToMelody(
      song([
        note(60, 0, 0.5),
        note(64, 0, 0.5),
        note(62, 1, 0.5),
        note(65, 1, 0.5),
        note(64, 2, 0.5),
        note(67, 2, 0.5),
      ]),
      generous,
    );
    expect(line.map((each) => each.pitch)).toEqual([64, 65, 67]);
  });

  it("never leaves two notes sounding at once", () => {
    const held = note(72, 0, 4);
    const line = reduceToMelody(
      song([held, note(70, 1, 1), note(71, 2, 1), note(69, 3, 1)]),
      generous,
    );
    expect(overlaps(line)).toBe(false);
    expect(line).toHaveLength(4);
  });

  it("keeps the tune playing under a held pedal note", () => {
    const line = reduceToMelody(
      song([
        note(84, 0, 4),
        note(72, 1, 0.4),
        note(74, 1.5, 0.4),
        note(76, 2, 0.4),
        note(77, 2.5, 0.4),
      ]),
      generous,
    );
    expect(line.map((each) => each.pitch)).toEqual([84, 72, 74, 76, 77]);
  });

  it("keeps every note of a legato descending line", () => {
    const line = reduceToMelody(
      song([
        note(72, 0, 0.6),
        note(71, 0.5, 0.6),
        note(69, 1, 0.6),
        note(67, 1.5, 0.6),
      ]),
      generous,
    );
    expect(line.map((each) => each.pitch)).toEqual([72, 71, 69, 67]);
  });

  it("owes nothing when only percussion is chosen", () => {
    const line = reduceToMelody(
      song([note(60, 0, 1), note(38, 0, 1, 1)], [track(0), track(1, true)]),
      { tracks: new Set([1]), maxNotesPerSecond: 12 } satisfies MelodyOptions,
    );
    expect(line).toEqual([]);
  });

  it("ignores percussion", () => {
    const line = reduceToMelody(
      song([note(60, 0, 1), note(100, 0, 1, 1)], [track(0), track(1, true)]),
      {
        tracks: new Set([0, 1]),
        maxNotesPerSecond: 12,
      } satisfies MelodyOptions,
    );
    expect(line.map((each) => each.pitch)).toEqual([60]);
  });

  it("reads only the chosen tracks", () => {
    const line = reduceToMelody(
      song([note(60, 0, 1), note(90, 0, 1, 1)], [track(0), track(1)]),
      generous,
    );
    expect(line.map((each) => each.pitch)).toEqual([60]);
  });

  it("falls back to every pitched track when none is chosen", () => {
    const line = reduceToMelody(
      song([note(60, 0, 1), note(90, 0, 1, 1)], [track(0), track(1)]),
      {
        tracks: new Set<number>(),
        maxNotesPerSecond: 12,
      } satisfies MelodyOptions,
    );
    expect(line.map((each) => each.pitch)).toEqual([90]);
  });

  it("holds the line under the rate ceiling", () => {
    const notes = Array.from({ length: 40 }, (_, index) =>
      note(60 + (index % 5), index * 0.05, 0.05),
    );
    const line = reduceToMelody(song(notes), {
      tracks: new Set([0]),
      maxNotesPerSecond: 4,
    } satisfies MelodyOptions);
    for (let index = 1; index < line.length; index += 1) {
      const gap = (line[index]?.start ?? 0) - (line[index - 1]?.start ?? 0);
      expect(gap).toBeGreaterThanOrEqual(0.25 - 1e-9);
    }
  });

  it("keeps the higher note when two fall inside one gap", () => {
    const line = reduceToMelody(song([note(64, 0, 0.05), note(60, 0.1, 0.9)]), {
      tracks: new Set([0]),
      maxNotesPerSecond: 2,
    } satisfies MelodyOptions);
    expect(line.map((each) => each.pitch)).toEqual([64]);
  });

  it("walks the peaks of an arpeggio rather than its inner voices", () => {
    const cycles = [64, 67, 65, 69];
    const notes = cycles.flatMap((top, cycle) => [
      note(48, cycle * 0.6, 0.15),
      note(55, cycle * 0.6 + 0.2, 0.15),
      note(top, cycle * 0.6 + 0.4, 0.15),
    ]);
    const line = reduceToMelody(song(notes), {
      tracks: new Set([0]),
      maxNotesPerSecond: 2,
    } satisfies MelodyOptions);
    expect(line.map((each) => each.pitch)).toEqual(cycles);
  });

  it("drops a stray far below the line rather than transposing it", () => {
    const notes = [
      note(72, 0, 0.4),
      note(74, 0.5, 0.4),
      note(72, 1, 0.4),
      note(24, 1.5, 0.4),
      note(74, 2, 0.4),
    ];
    const line = reduceToMelody(song(notes), generous);
    expect(line.map((each) => each.pitch)).toEqual([72, 74, 72, 74]);
  });

  it("only ever emits pitches the song actually contains", () => {
    const notes = [
      note(84, 0, 0.4),
      note(83, 0.5, 0.4),
      note(60, 1, 0.4),
      note(62, 1.5, 0.4),
      note(61, 2, 0.4),
      note(59, 2.5, 0.4),
    ];
    const source = song(notes);
    const byId = new Map(source.notes.map((each) => [each.id, each.pitch]));
    for (const each of reduceToMelody(source, generous)) {
      expect(each.pitch).toBe(byId.get(each.id));
    }
  });

  it("gives the same line every time", () => {
    const notes = Array.from({ length: 60 }, (_, index) =>
      note(55 + ((index * 7) % 24), index * 0.11, 0.3),
    );
    const first = reduceToMelody(song(notes), generous);
    const second = reduceToMelody(song(notes), generous);
    expect(second).toEqual(first);
  });

  it("survives an empty song", () => {
    expect(reduceToMelody(song([]), generous)).toEqual([]);
  });

  it("clamps a rate into range", () => {
    expect(clampMelodyRate(9999)).toBe(melodyRateRange.max);
    expect(clampMelodyRate(0)).toBe(melodyRateRange.min);
    expect(clampMelodyRate(-5)).toBe(melodyRateRange.min);
    expect(clampMelodyRate(3.4)).toBe(3);
  });
});
