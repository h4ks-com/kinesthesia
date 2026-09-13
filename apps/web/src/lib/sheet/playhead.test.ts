import { describe, expect, it } from "vitest";
import type { ScoreMark } from "@/lib/sheet/marks";
import {
  easedScroll,
  nextPlayhead,
  playheadScrollTarget,
} from "@/lib/sheet/playhead";

function mark(top: number, left: number, height = 100): ScoreMark {
  return { top, left, height };
}

const marks = new Map<number, readonly ScoreMark[]>([
  [1, [mark(0, 10)]],
  [2, [mark(0, 40)]],
  [3, [mark(300, 10)]],
  // A tie: struck once, written twice.
  [4, [mark(300, 90), mark(600, 10)]],
]);

describe("nextPlayhead", () => {
  it("stands on the furthest of a moment written across several parts", () => {
    expect(nextPlayhead(null, new Set([1, 2]), marks, false)).toEqual(
      mark(0, 40),
    );
  });

  it("stands where the note is struck, never on a tie's continuation", () => {
    expect(nextPlayhead(null, new Set([4]), marks, false)).toEqual(
      mark(300, 90),
    );
  });

  it("holds its place where the score has nothing drawn for the moment", () => {
    const standing = mark(300, 10);
    expect(nextPlayhead(standing, new Set([99]), marks, false)).toBe(standing);
  });

  it("holds its place rather than stepping back to a note still ringing", () => {
    const standing = mark(300, 10);
    expect(nextPlayhead(standing, new Set([1]), marks, false)).toBe(standing);
  });

  it("moves across a system before moving down to the next", () => {
    expect(nextPlayhead(mark(0, 10), new Set([2]), marks, false)).toEqual(
      mark(0, 40),
    );
    expect(nextPlayhead(mark(0, 40), new Set([3]), marks, false)).toEqual(
      mark(300, 10),
    );
  });

  it("goes back where the listener asked to be somewhere else", () => {
    expect(nextPlayhead(mark(300, 10), new Set([1]), marks, true)).toEqual(
      mark(0, 10),
    );
  });
});

describe("playheadScrollTarget", () => {
  it("centres the bar's system in the panel", () => {
    expect(playheadScrollTarget(mark(600, 0, 200), 500, 4000)).toBe(450);
  });

  it("holds at the top rather than scrolling above the first system", () => {
    expect(playheadScrollTarget(mark(40, 0, 200), 500, 4000)).toBe(0);
  });

  it("stops at the last system rather than scrolling past the end", () => {
    expect(playheadScrollTarget(mark(3900, 0, 200), 500, 4000)).toBe(3500);
  });

  it("puts a system taller than the panel at its top", () => {
    expect(playheadScrollTarget(mark(600, 0, 900), 500, 4000)).toBe(600);
  });

  it("meets the centred case continuously as a system grows past the panel", () => {
    const justUnder = playheadScrollTarget(mark(600, 0, 499), 500, 4000);
    const justOver = playheadScrollTarget(mark(600, 0, 501), 500, 4000);
    expect(Math.abs(justOver - justUnder)).toBeLessThan(1);
  });

  it("stays at the top for a score shorter than the panel", () => {
    expect(playheadScrollTarget(mark(180, 0, 100), 500, 300)).toBe(0);
  });
});

describe("easedScroll", () => {
  it("moves toward the target without overshooting it", () => {
    const stepped = easedScroll(0, 1000, 1000 / 30);
    expect(stepped).toBeGreaterThan(0);
    expect(stepped).toBeLessThan(1000);
  });

  it("covers more ground in a longer frame", () => {
    expect(easedScroll(0, 1000, 1000 / 30)).toBeLessThan(
      easedScroll(0, 1000, 1000 / 15),
    );
  });

  it("rests once it is there", () => {
    expect(easedScroll(500, 500, 1000 / 30)).toBe(500);
  });

  it("is all but there a second later, however far the jump was", () => {
    let scroll = 0;
    for (let frame = 0; frame < 60; frame += 1) {
      scroll = easedScroll(scroll, 800, 1000 / 60);
    }
    expect(scroll).toBeGreaterThan(760);
    expect(scroll).toBeLessThan(800);
  });
});
