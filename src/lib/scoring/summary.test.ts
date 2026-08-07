import { describe, expect, it } from "vitest";
import { emptyHolds } from "@/lib/scoring/hold";
import { emptyScore, type Score } from "@/lib/scoring/judge";
import {
  lowestRank,
  rankOf,
  type Summary,
  spreadOf,
  summarise,
} from "@/lib/scoring/summary";

function score(over: Partial<Score> = {}): Score {
  return { ...emptyScore, ...over };
}

function summary(over: Partial<Summary> = {}): Summary {
  return { points: 0, notes: 1, streak: 0, hold: 1, spread: 0, ...over };
}

describe("spreadOf", () => {
  it("is nothing before anything has been struck", () => {
    expect(spreadOf([])).toBe(0);
  });

  it("ignores which side of the beat a strike fell", () => {
    expect(spreadOf([-0.04, 0.04])).toBeCloseTo(0.04, 10);
  });

  // A player who is always 40ms late is tidy, just offset, and the spread has
  // to say so rather than reading as scatter.
  it("reads a steady lateness as its own size", () => {
    expect(spreadOf([0.04, 0.04, 0.04])).toBeCloseTo(0.04, 10);
  });

  it("grows as the strikes scatter", () => {
    expect(spreadOf([-0.12, 0.12])).toBeGreaterThan(spreadOf([-0.02, 0.02]));
  });
});

describe("summarise", () => {
  it("counts everything not missed as got through", () => {
    const got = summarise(
      score({ perfect: 6, good: 2, missed: 2, bestCombo: 5 }),
      100,
      emptyHolds,
      [],
    );
    expect(got.notes).toBeCloseTo(0.8, 10);
    expect(got.streak).toBe(5);
  });

  it("says nothing was got through before a note is judged", () => {
    expect(summarise(emptyScore, 0, emptyHolds, []).notes).toBe(0);
  });

  it("treats a song asking for no holds as nothing dropped", () => {
    expect(summarise(score({ perfect: 4 }), 0, emptyHolds, []).hold).toBe(1);
  });

  it("carries the holds that were let go", () => {
    const got = summarise(score({ perfect: 4 }), 0, { kept: 3, letGo: 1 }, []);
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
