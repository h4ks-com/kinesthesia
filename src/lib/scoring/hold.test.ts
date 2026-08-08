import { describe, expect, it } from "vitest";
import {
  droppedEarly,
  holdBonus,
  holdFrom,
  holdRate,
  holdSlack,
  worthSaying,
} from "@/lib/scoring/hold";
import { lateWindow } from "@/lib/scoring/judge";

describe("holdBonus", () => {
  it("pays nothing for a note let go before holding starts", () => {
    expect(holdBonus(2, holdFrom / 2)).toBe(0);
    expect(holdBonus(2, 0)).toBe(0);
  });

  it("pays nothing at the moment holding starts", () => {
    expect(holdBonus(2, holdFrom)).toBe(0);
  });

  it("pays for the time held past that", () => {
    expect(holdBonus(2, holdFrom + 1)).toBe(holdRate);
  });

  it("pays more the longer it is kept down", () => {
    expect(holdBonus(4, 3)).toBeGreaterThan(holdBonus(4, 1));
  });

  // The song stops asking once the note is over, so leaning on a key cannot be
  // farmed for points.
  it("pays nothing extra past the end of the note", () => {
    expect(holdBonus(1, 1)).toBe(holdBonus(1, 30));
  });

  it("pays nothing for a note too short to hold at all", () => {
    expect(holdBonus(0.1, 0.1)).toBe(0);
  });

  it("never pays a negative", () => {
    expect(holdBonus(0.05, 5)).toBe(0);
  });
});

describe("droppedEarly", () => {
  it("says nothing about a short note, however fast it is let go", () => {
    expect(droppedEarly(0.3, 0)).toBe(false);
    expect(droppedEarly(worthSaying - 0.01, 0)).toBe(false);
  });

  it("stays quiet across a run of ordinary notes let go a shade early", () => {
    const ordinary = [0.3, 0.45, 0.5, 0.6, 0.8, 1.0];
    for (const length of ordinary) {
      expect(droppedEarly(length, length * 0.6)).toBe(false);
    }
  });

  it("speaks up for a long note dropped near its start", () => {
    expect(droppedEarly(3, 0.4)).toBe(true);
  });

  it("stays quiet when a long note is seen nearly out", () => {
    expect(droppedEarly(3, 3 * (1 - holdSlack) + 0.01)).toBe(false);
  });

  it("stays quiet when a long note is held past its end", () => {
    expect(droppedEarly(3, 9)).toBe(false);
  });

  // A hold is timed from the strike, so a note struck as late as one still can
  // be is the worst case the reminder has to stay quiet through.
  it("stays quiet for a note struck at the deadline and held to its end", () => {
    for (const length of [worthSaying, 2, 5]) {
      expect(droppedEarly(length, length - lateWindow)).toBe(false);
    }
  });
});
