import { describe, expect, it } from "vitest";
import {
  clampOctave,
  defaultOctave,
  highestOctave,
  lowestOctave,
  pitchForCode,
} from "@/lib/input/keyboard-map";

describe("pitchForCode", () => {
  it("puts the lower row on the octave root", () => {
    expect(pitchForCode("KeyZ", 3)).toBe(48);
    expect(pitchForCode("KeyQ", 3)).toBe(60);
  });

  it("places black keys a semitone above their white key", () => {
    const c = pitchForCode("KeyZ", defaultOctave);
    const cSharp = pitchForCode("KeyS", defaultOctave);
    expect(c).not.toBeNull();
    expect(cSharp).toBe((c ?? 0) + 1);
  });

  it("leaves no black key between E and F or B and C", () => {
    expect(pitchForCode("KeyC", 3)).toBe(52);
    expect(pitchForCode("KeyV", 3)).toBe(53);
    expect(pitchForCode("KeyM", 3)).toBe(59);
    expect(pitchForCode("Comma", 3)).toBe(60);
  });

  it("shifts a whole octave with the octave number", () => {
    const low = pitchForCode("KeyZ", 3);
    const high = pitchForCode("KeyZ", 4);
    expect(high).toBe((low ?? 0) + 12);
  });

  it("ignores keys that are not mapped", () => {
    expect(pitchForCode("KeyP", 3)).toBeNull();
    expect(pitchForCode("Escape", 3)).toBeNull();
  });
});

describe("clampOctave", () => {
  it("stays inside the playable range", () => {
    expect(clampOctave(lowestOctave - 3)).toBe(lowestOctave);
    expect(clampOctave(highestOctave + 3)).toBe(highestOctave);
    expect(clampOctave(defaultOctave)).toBe(defaultOctave);
  });
});
