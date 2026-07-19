import { describe, expect, it } from "vitest";
import {
  brightnessRange,
  clampVoicing,
  defaultVoicing,
  isDefaultVoicing,
  shapingFor,
  velocityFor,
} from "@/lib/audio/voicing";
import type { SongTrack } from "@/lib/midi/song";

const track: SongTrack = {
  index: 0,
  name: "Strings",
  instrument: "violin",
  program: 40,
  percussion: false,
  noteCount: 8,
};

describe("defaultVoicing", () => {
  it("keeps the instrument the file named", () => {
    expect(defaultVoicing(track).program).toBe(40);
  });

  it("is recognised as untouched", () => {
    expect(isDefaultVoicing(defaultVoicing(track), track)).toBe(true);
  });
});

describe("shapingFor", () => {
  it("asks for nothing when the track is untouched", () => {
    expect(shapingFor(defaultVoicing(track))).toEqual({});
    expect(shapingFor(null)).toEqual({});
  });

  it("sends only what was moved, in seconds", () => {
    expect(shapingFor({ ...defaultVoicing(track), attack: 250 })).toEqual({
      ampAttack: 0.25,
    });
    expect(shapingFor({ ...defaultVoicing(track), release: 2000 })).toEqual({
      ampRelease: 2,
    });
  });

  it("filters only below the top of the range", () => {
    expect(
      shapingFor({ ...defaultVoicing(track), brightness: 4000 }),
    ).toHaveProperty("lpfCutoffHz", 4000);
    expect(
      shapingFor({ ...defaultVoicing(track), brightness: brightnessRange.max }),
    ).not.toHaveProperty("lpfCutoffHz");
  });
});

describe("velocityFor", () => {
  it("leaves a written velocity alone at the default level", () => {
    expect(velocityFor(0.8, defaultVoicing(track))).toBe(102);
    expect(velocityFor(0.8, null)).toBe(102);
  });

  it("scales by the level and stays on the sampler's scale", () => {
    expect(velocityFor(0.8, { ...defaultVoicing(track), volume: 50 })).toBe(51);
    expect(velocityFor(1, { ...defaultVoicing(track), volume: 150 })).toBe(127);
  });
});

describe("clampVoicing", () => {
  it("holds every field inside its range", () => {
    const wild = {
      program: 999,
      attack: -50,
      release: 99999,
      brightness: 1,
      volume: 400,
    };
    expect(clampVoicing(wild)).toEqual({
      program: 127,
      attack: 0,
      release: 4000,
      brightness: 200,
      volume: 150,
    });
  });

  it("reads an unusable value as the bottom of its range", () => {
    expect(
      clampVoicing({ ...defaultVoicing(track), attack: Number.NaN }).attack,
    ).toBe(0);
  });
});
