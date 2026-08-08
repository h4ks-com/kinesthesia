export const perfectWindow = 0.05;
export const goodWindow = 0.15;
/** How far past a note the song carries on before it counts as gone by: the
 * point where learn stops to wait and a match writes the note off. Wider than
 * the window that still scores, so being a little late costs only a grade. */
export const lateWindow = 0.3;

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

/** The share of the whole part that has been answered, which climbs through a
 * run where accuracy only reads the notes reached so far. Nothing is owed back
 * for a note struck that the song never asked for, so a run cannot pass 100. */
export function gotShare(score: Score, owed: number): number {
  return owed === 0 ? 0 : Math.min(1, (score.perfect + score.good) / owed);
}

export function scorePoints(score: Score): number {
  return score.perfect * 100 + score.good * 50 + score.bestCombo * 10;
}
