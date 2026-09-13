import { describe, expect, it } from "vitest";
import { adaptedVoiceLimit, workingSet } from "@/lib/audio/engine";
import type { Song, SongTrack } from "@/lib/midi/song";

function track(index: number, program: number, percussion = false): SongTrack {
  return {
    index,
    name: `track ${index}`,
    instrument: "",
    program,
    percussion,
    noteCount: 0,
  };
}

/** Only the tracks matter here; free roam carries no written notes at all. */
function songOf(tracks: readonly SongTrack[]): Song {
  return { tracks } as Song;
}

describe("adaptedVoiceLimit", () => {
  it("climbs when on time and pressing against the ceiling", () => {
    expect(adaptedVoiceLimit(96, 25, 96)).toBe(104);
  });

  it("holds when on time but nowhere near the ceiling", () => {
    expect(adaptedVoiceLimit(96, 25, 10)).toBe(96);
  });

  it("backs off hard when a tick lands late", () => {
    expect(adaptedVoiceLimit(200, 90, 200)).toBe(140);
  });

  it("backs off even when few voices sound, since a late tick is the machine behind", () => {
    expect(adaptedVoiceLimit(200, 90, 0)).toBe(140);
  });

  it("holds steady in the band between", () => {
    expect(adaptedVoiceLimit(200, 40, 200)).toBe(200);
  });

  it("never climbs past the ceiling", () => {
    expect(adaptedVoiceLimit(256, 25, 256)).toBe(256);
  });

  it("never falls below the floor", () => {
    expect(adaptedVoiceLimit(48, 200, 48)).toBe(48);
  });
});

describe("what a song may sound", () => {
  // The bank is the only path for a live key press, and the fallback while a
  // melodic note's own recordings are still coming. Keeping only the drums cut
  // held chords and silenced the next press.
  it("keeps melodic instruments in the bank, not only the drums", () => {
    const wanted = workingSet(
      songOf([track(1, 0), track(2, 30), track(10, 0, true)]),
      new Map(),
    );

    expect([...wanted.bank].sort()).toEqual([
      "acoustic_grand_piano",
      "distortion_guitar",
      "drums",
    ]);
    expect(wanted.percussion).toHaveLength(1);
  });

  it("keeps the voice player to the melodic tracks", () => {
    const wanted = workingSet(
      songOf([track(1, 0), track(10, 0, true)]),
      new Map(),
    );

    expect([...wanted.voices]).toEqual(["acoustic_grand_piano"]);
  });

  // Free roam has tracks but no notes, so a set derived from notes would be
  // empty and drop the very instrument being played.
  it("holds an instrument for a song that has written no notes yet", () => {
    expect(workingSet(songOf([track(1, 24)]), new Map()).bank.size).toBe(1);
  });
});
