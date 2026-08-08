import { describe, expect, it } from "vitest";
import { emptyHolds } from "@/lib/scoring/hold";
import { emptyScore, type Score } from "@/lib/scoring/judge";
import { emptyShape } from "@/lib/scoring/rail";
import {
  lowestRank,
  rankOf,
  type Summary,
  summarise,
} from "@/lib/scoring/summary";

function score(over: Partial<Score> = {}): Score {
  return { ...emptyScore, ...over };
}

function summary(over: Partial<Summary> = {}): Summary {
  return {
    points: 0,
    notes: 1,
    accuracy: 1,
    streak: 0,
    hold: 1,
    spread: 0,
    shape: emptyShape,
    ...over,
  };
}

describe("summarise", () => {
  it("counts everything not missed as got through", () => {
    const got = summarise({
      score: score({ perfect: 6, good: 2, missed: 2, bestCombo: 5 }),
      holds: emptyHolds,
      spread: 0,
      shape: emptyShape,
    });
    expect(got.notes).toBeCloseTo(0.8, 10);
    expect(got.streak).toBe(5);
  });

  // The scores column has always held the weighted share, so a run of goods
  // must not post as a run of perfects just because none were missed.
  it("keeps the weighted share apart from the share not missed", () => {
    const got = summarise({
      score: score({ good: 4 }),
      holds: emptyHolds,
      spread: 0,
      shape: emptyShape,
    });
    expect(got.notes).toBe(1);
    expect(got.accuracy).toBe(0.5);
  });

  it("says nothing was got through before a note is judged", () => {
    expect(
      summarise({
        score: emptyScore,
        holds: emptyHolds,
        spread: 0,
        shape: emptyShape,
      }).notes,
    ).toBe(0);
  });

  it("treats a song asking for no holds as nothing dropped", () => {
    expect(
      summarise({
        score: score({ perfect: 4 }),
        holds: emptyHolds,
        spread: 0,
        shape: emptyShape,
      }).hold,
    ).toBe(1);
  });

  it("carries the holds that were let go", () => {
    const got = summarise({
      score: score({ perfect: 4 }),
      holds: { kept: 3, letGo: 1 },
      spread: 0,
      shape: emptyShape,
    });
    expect(got.hold).toBe(0.75);
  });
});

describe("rankOf", () => {
  it("gives the top rank only to a run that is accurate and tidy", () => {
    expect(rankOf(summary({ notes: 1, spread: 0.02 }))).toBe("S");
  });

  // Both bars have to be cleared, or mashing through every note while landing
  // nowhere near the beat would rank the same as playing it.
  it("withholds it from a run that hit everything sloppily", () => {
    expect(rankOf(summary({ notes: 1, spread: 0.2 }))).not.toBe("S");
  });

  it("withholds it from a tidy run that missed a lot", () => {
    expect(rankOf(summary({ notes: 0.5, spread: 0.01 }))).not.toBe("S");
  });

  it("falls to the bottom when neither bar is met", () => {
    expect(rankOf(summary({ notes: 0.2, spread: 0.25 }))).toBe(lowestRank);
  });

  it("never ranks a worse run above a better one", () => {
    const better = rankOf(summary({ notes: 0.95, spread: 0.05 }));
    const worse = rankOf(summary({ notes: 0.7, spread: 0.12 }));
    expect(better < worse).toBe(true);
  });
});
