import { describe, expect, it } from "vitest";
import {
  accuracy,
  applyJudgement,
  emptyScore,
  goodWindow,
  judge,
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
