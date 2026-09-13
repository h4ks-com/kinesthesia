import { describe, expect, it } from "vitest";
import { createNoteSweep } from "@/lib/midi/part";
import type { SongNote } from "@/lib/midi/song";

function note(id: number, start: number, pitch = 60): SongNote {
  return {
    id,
    pitch,
    start,
    end: start + 0.5,
    release: start + 0.5,
    velocity: 100,
    track: 0,
  };
}

const notes = [note(1, 0), note(2, 0, 64), note(3, 1), note(4, 10)];

describe("createNoteSweep", () => {
  it("holds the whole chord due at one moment", () => {
    const sweep = createNoteSweep(notes);
    sweep.moveTo(-0.1);
    expect([...sweep.next].sort()).toEqual([1, 2]);
  });

  it("moves on to the next attack once the last one is due", () => {
    const sweep = createNoteSweep(notes);
    sweep.moveTo(0);
    expect([...sweep.next]).toEqual([3]);
  });

  it("empties past the last attack", () => {
    const sweep = createNoteSweep(notes);
    sweep.moveTo(20);
    expect([...sweep.next]).toEqual([]);
  });

  it("reads its opening position as a jump, having come from nowhere", () => {
    expect(createNoteSweep(notes).moveTo(0)).toBe(true);
  });

  it("reads a run of playback as no jump at all", () => {
    const sweep = createNoteSweep(notes);
    sweep.moveTo(0);
    expect(sweep.moveTo(0.016)).toBe(false);
    expect(sweep.moveTo(0.033)).toBe(false);
  });

  // Playback only ever carries the clock forward, so any step back is somebody
  // asking to be somewhere else however small it is. A slow scrub backwards
  // arrives as a run of steps well under a second each.
  it("reads a small step backwards as a jump", () => {
    const sweep = createNoteSweep(notes);
    sweep.moveTo(10);
    expect(sweep.moveTo(9.6)).toBe(true);
  });

  it("forgives the clock's own jitter rather than reading it as a scrub", () => {
    const sweep = createNoteSweep(notes);
    sweep.moveTo(10);
    expect(sweep.moveTo(9.98)).toBe(false);
  });

  it("reads a long step ahead as a jump", () => {
    const sweep = createNoteSweep(notes);
    sweep.moveTo(0);
    expect(sweep.moveTo(8)).toBe(true);
  });

  it("finds the attacks again after moving back", () => {
    const sweep = createNoteSweep(notes);
    sweep.moveTo(10);
    expect([...sweep.next]).toEqual([]);
    sweep.moveTo(-0.1);
    expect([...sweep.next].sort()).toEqual([1, 2]);
  });
});
