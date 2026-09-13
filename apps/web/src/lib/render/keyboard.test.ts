import { describe, expect, it } from "vitest";
import {
  clampKeyWidth,
  defaultKeyWidth,
  keyboardBand,
  keyboardMetrics,
  keyWidthRange,
  pitchAtPoint,
  whiteKeys,
} from "@/lib/render/keyboard";

const tallViewport = { width: 400, height: 500 };

function pointOnKeyboard(x: number, keyWidth: number, pan = 0): number | null {
  const band = keyboardBand(tallViewport.height);
  return pitchAtPoint(x, band.top + band.height * 0.9, {
    ...tallViewport,
    keyWidth,
    pan,
  });
}

describe("keyboardMetrics", () => {
  it("keeps every key at the requested width", () => {
    const metrics = keyboardMetrics(400, 40);
    expect(metrics.whiteWidth).toBe(40);
    expect(metrics.total).toBe(40 * whiteKeys.length);
  });

  it("stretches the keys when the viewport is wider than the keyboard", () => {
    const width = 40 * whiteKeys.length + 520;
    expect(keyboardMetrics(width, 40).whiteWidth).toBe(
      width / whiteKeys.length,
    );
  });

  it("offers pan only for the part of the keyboard that overflows", () => {
    expect(keyboardMetrics(400, 40).maxPan).toBe(40 * whiteKeys.length - 400);
    expect(keyboardMetrics(9000, 40).maxPan).toBe(0);
  });

  it("widens the keyboard as the key width grows, so panning grows too", () => {
    const narrow = keyboardMetrics(400, 26);
    const wide = keyboardMetrics(400, 52);
    expect(wide.total).toBeGreaterThan(narrow.total);
    expect(wide.maxPan).toBeGreaterThan(narrow.maxPan);
  });
});

describe("clampKeyWidth", () => {
  it("holds the value inside the range", () => {
    expect(clampKeyWidth(keyWidthRange.min - 30)).toBe(keyWidthRange.min);
    expect(clampKeyWidth(keyWidthRange.max + 30)).toBe(keyWidthRange.max);
    expect(clampKeyWidth(defaultKeyWidth)).toBe(defaultKeyWidth);
  });

  it("rounds to whole pixels", () => {
    expect(clampKeyWidth(31.6)).toBe(32);
  });
});

describe("pitchAtPoint", () => {
  it("ignores anything above the keyboard", () => {
    const band = keyboardBand(tallViewport.height);
    const above = pitchAtPoint(10, band.top - 1, {
      ...tallViewport,
      keyWidth: 40,
      pan: 0,
    });
    expect(above).toBeNull();
  });

  it("reads the lowest white key at the left edge", () => {
    expect(pointOnKeyboard(4, 40)).toBe(21);
  });

  it("follows the key width, so a wider key covers a wider band", () => {
    expect(pointOnKeyboard(50, 40)).toBe(23);
    expect(pointOnKeyboard(50, 80)).toBe(21);
  });

  it("reads a black key near the top of the keyboard", () => {
    const band = keyboardBand(tallViewport.height);
    const black = pitchAtPoint(40, band.top + band.height * 0.2, {
      ...tallViewport,
      keyWidth: 40,
      pan: 0,
    });
    expect(black).toBe(22);
  });

  it("reads the white key below when the same column is tapped low down", () => {
    expect(pointOnKeyboard(40, 40)).toBe(23);
  });

  it("shifts with the pan offset", () => {
    expect(pointOnKeyboard(4, 40, 40)).toBe(23);
  });

  it("returns nothing past the end of the keyboard", () => {
    expect(pointOnKeyboard(40 * whiteKeys.length + 10, 40)).toBeNull();
  });
});
