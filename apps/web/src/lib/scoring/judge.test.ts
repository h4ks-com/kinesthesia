import { describe, expect, it } from "vitest";
import {
  accuracy,
  applyJudgement,
  emptyScore,
  goodWindow,
  gotShare,
  judge,
  lateWindow,
  perfectWindow,
  type Score,
  scorePoints,
} from "@/lib/scoring/judge";

describe("judge", () => {
  it("treats early and late the same", () => {
    expect(judge(0.03)).toBe("perfect");
    expect(judge(-0.03)).toBe("perfect");
  });

  it("grades by window", () => {
    expect(judge(0)).toBe("perfect");
    expect(judge(perfectWindow)).toBe("perfect");
    expect(judge(perfectWindow + 0.001)).toBe("good");
    expect(judge(goodWindow)).toBe("good");
    expect(judge(goodWindow + 0.001)).toBe("miss");
  });
});

describe("lateWindow", () => {
  it("gives a note longer than it scores for, so being late costs only a grade", () => {
    expect(lateWindow).toBeGreaterThan(goodWindow);
  });
});

describe("applyJudgement", () => {
  it("builds a combo on hits and breaks it on a miss", () => {
    let score = emptyScore;
    score = applyJudgement(score, "perfect");
    score = applyJudgement(score, "good");
    expect(score.combo).toBe(2);
    expect(score.bestCombo).toBe(2);

    score = applyJudgement(score, "miss");
    expect(score.combo).toBe(0);
    expect(score.bestCombo).toBe(2);
    expect(score.missed).toBe(1);
  });

  it("keeps the best combo after it breaks", () => {
    let score = emptyScore;
    for (let index = 0; index < 5; index += 1) {
      score = applyJudgement(score, "perfect");
    }
    score = applyJudgement(score, "miss");
    score = applyJudgement(score, "perfect");
    expect(score.bestCombo).toBe(5);
    expect(score.combo).toBe(1);
  });
});

describe("accuracy", () => {
  it("is full when nothing has been judged", () => {
    expect(accuracy(emptyScore)).toBe(1);
  });

  it("counts a good as half a perfect", () => {
    const score: Score = { ...emptyScore, perfect: 1, good: 1 };
    expect(accuracy(score)).toBeCloseTo(0.75);
  });

  it("drops with misses", () => {
    const score: Score = { ...emptyScore, perfect: 1, missed: 1 };
    expect(accuracy(score)).toBeCloseTo(0.5);
  });
});

describe("scorePoints", () => {
  it("rewards perfects over goods and adds a combo bonus", () => {
    const score: Score = { ...emptyScore, perfect: 2, good: 2, bestCombo: 4 };
    expect(scorePoints(score)).toBe(2 * 100 + 2 * 50 + 4 * 10);
  });
});

// The header reads this live, where accuracy only ever describes the notes
// already reached: a player two bars into a song is not 100% through it.
describe("gotShare", () => {
  it("is nothing before a note is answered", () => {
    expect(gotShare(emptyScore, 40)).toBe(0);
  });

  it("climbs with the notes answered, not with how near the beat they were", () => {
    const early: Score = { ...emptyScore, perfect: 10 };
    const late: Score = { ...emptyScore, perfect: 5, good: 5 };
    expect(gotShare(early, 40)).toBeCloseTo(0.25);
    expect(gotShare(late, 40)).toBeCloseTo(0.25);
  });

  it("counts a missed note as one not got", () => {
    const score: Score = { ...emptyScore, perfect: 10, missed: 10 };
    expect(gotShare(score, 40)).toBeCloseTo(0.25);
  });

  it("reads a whole song played as all of it", () => {
    const score: Score = { ...emptyScore, perfect: 30, good: 10 };
    expect(gotShare(score, 40)).toBe(1);
  });

  // Striking keys nothing asked for is judged, so a masher answers more notes
  // than the part holds.
  it("never passes the whole song, however many keys were struck", () => {
    const score: Score = { ...emptyScore, perfect: 90 };
    expect(gotShare(score, 40)).toBe(1);
  });

  it("is nothing when no part is owed", () => {
    expect(gotShare({ ...emptyScore, perfect: 3 }, 0)).toBe(0);
  });
});
