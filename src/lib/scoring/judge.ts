export const perfectWindow = 0.05;
export const goodWindow = 0.15;

export const judgements = ["perfect", "good", "miss"] as const;
export type Judgement = (typeof judgements)[number];

export type Score = {
  readonly perfect: number;
  readonly good: number;
  readonly missed: number;
  readonly combo: number;
  readonly bestCombo: number;
};

export const emptyScore: Score = {
  perfect: 0,
  good: 0,
  missed: 0,
  combo: 0,
  bestCombo: 0,
};

export function judge(deltaSeconds: number): Judgement {
  const distance = Math.abs(deltaSeconds);
  if (distance <= perfectWindow) {
    return "perfect";
  }
  if (distance <= goodWindow) {
    return "good";
  }
  return "miss";
}

export function applyJudgement(score: Score, judgement: Judgement): Score {
  if (judgement === "miss") {
    return { ...score, missed: score.missed + 1, combo: 0 };
  }
  const combo = score.combo + 1;
  return {
    ...score,
    perfect: judgement === "perfect" ? score.perfect + 1 : score.perfect,
    good: judgement === "good" ? score.good + 1 : score.good,
    combo,
    bestCombo: Math.max(score.bestCombo, combo),
  };
}

export function totalJudged(score: Score): number {
  return score.perfect + score.good + score.missed;
}

/** Weighted the way rhythm games normally do it: a good counts for half a
 * perfect, and a miss for nothing. */
export function accuracy(score: Score): number {
  const total = totalJudged(score);
  if (total === 0) {
    return 1;
  }
  return (score.perfect + score.good * 0.5) / total;
}

export function scorePoints(score: Score): number {
  return score.perfect * 100 + score.good * 50 + score.bestCombo * 10;
}
