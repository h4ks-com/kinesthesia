import { describe, expect, it } from "vitest";
import { trackColor, trackColorCount } from "@/lib/midi/palette";

function hueOf(hex: string): number {
  const value = hex.replace("#", "");
  const red = Number.parseInt(value.slice(0, 2), 16) / 255;
  const green = Number.parseInt(value.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(value.slice(4, 6), 16) / 255;
  const max = Math.max(red, green, blue);
  const span = max - Math.min(red, green, blue);
  if (span === 0) {
    return 0;
  }
  const raw =
    max === red
      ? (green - blue) / span + (green < blue ? 6 : 0)
      : max === green
        ? (blue - red) / span + 2
        : (red - green) / span + 4;
  return raw * 60;
}

/** Shortest way round the wheel, so 350 and 10 read as 20 apart. */
function apart(left: number, right: number): number {
  const gap = Math.abs(left - right) % 360;
  return Math.min(gap, 360 - gap);
}

describe("trackColor", () => {
  it("gives each track its own colour up to the whole palette", () => {
    const glows = new Set<string>();
    for (let track = 0; track < trackColorCount; track += 1) {
      glows.add(trackColor(track).glow);
    }
    expect(glows.size).toBe(trackColorCount);
  });

  it("keeps neighbouring tracks far apart in hue", () => {
    for (let track = 0; track < trackColorCount; track += 1) {
      const here = hueOf(trackColor(track).glow);
      const next = hueOf(trackColor(track + 1).glow);
      expect(apart(here, next)).toBeGreaterThan(60);
    }
  });

  it("spreads the whole palette round the wheel", () => {
    const hues = Array.from({ length: trackColorCount }, (_, track) =>
      hueOf(trackColor(track).glow),
    ).sort((left, right) => left - right);
    for (let index = 0; index < hues.length; index += 1) {
      const here = hues[index] ?? 0;
      const next = hues[(index + 1) % hues.length] ?? 0;
      expect(apart(here, next)).toBeGreaterThan(20);
    }
  });

  it("wraps round for a song with more tracks than colours", () => {
    expect(trackColor(trackColorCount)).toEqual(trackColor(0));
  });
});
