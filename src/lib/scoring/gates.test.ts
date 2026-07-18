import { describe, expect, it } from "vitest";
import type { Song, SongNote } from "@/lib/midi/song";
import { buildGates, busiestTrack, gateIndexAt } from "@/lib/scoring/gates";

function note(pitch: number, start: number, track: number): SongNote {
  return {
    id: start * 100 + pitch,
    pitch,
    start,
    end: start + 0.5,
    velocity: 0.8,
    track,
  };
}

function song(notes: SongNote[]): Song {
  const tracks = [...new Set(notes.map((entry) => entry.track))].map(
    (index) => ({
      index,
      name: `Track ${index}`,
      instrument: "acoustic grand piano",
      program: 0,
      percussion: false,
      noteCount: notes.filter((entry) => entry.track === index).length,
    }),
  );
  return { name: "test", duration: 10, notes, tracks };
}

function owned(source: Song, tracks: ReadonlySet<number>): SongNote[] {
  return source.notes.filter((entry) => tracks.has(entry.track));
}

describe("buildGates", () => {
  it("groups notes struck together into one gate", () => {
    const gates = buildGates(
      owned(
        song([note(60, 0, 0), note(64, 0.01, 0), note(67, 0.02, 0)]),
        new Set([0]),
      ),
    );
    expect(gates).toHaveLength(1);
    expect(gates[0]?.pitches).toEqual([60, 64, 67]);
  });

  it("keeps notes further apart as separate gates", () => {
    const gates = buildGates(
      owned(song([note(60, 0, 0), note(62, 0.5, 0)]), new Set([0])),
    );
    expect(gates).toHaveLength(2);
  });

  it("only takes the tracks the player owns", () => {
    const gates = buildGates(
      owned(song([note(60, 0, 0), note(62, 1, 1)]), new Set([1])),
    );
    expect(gates).toHaveLength(1);
    expect(gates[0]?.pitches).toEqual([62]);
  });

  it("is empty when the player owns nothing", () => {
    expect(buildGates(owned(song([note(60, 0, 0)]), new Set()))).toEqual([]);
  });
});

describe("gateIndexAt", () => {
  const gates = [
    { start: 0, pitches: [60] },
    { start: 1, pitches: [62] },
    { start: 2, pitches: [64] },
  ];

  it("starts at the beginning", () => {
    expect(gateIndexAt(gates, 0)).toBe(0);
  });

  it("finds the gate a seek lands on", () => {
    expect(gateIndexAt(gates, 1.5)).toBe(2);
  });

  it("runs off the end past the last gate", () => {
    expect(gateIndexAt(gates, 99)).toBe(3);
  });
});

describe("busiestTrack", () => {
  it("picks the track carrying the most notes", () => {
    const notes = [
      note(60, 0, 0),
      note(62, 1, 1),
      note(64, 2, 1),
      note(65, 3, 1),
    ];
    expect(busiestTrack(song(notes))).toBe(1);
  });
});
