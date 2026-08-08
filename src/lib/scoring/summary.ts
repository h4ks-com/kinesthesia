import { type HoldTally, holdShare } from "@/lib/scoring/hold";
import { accuracy, type Score, totalJudged } from "@/lib/scoring/judge";

/** What a finished run is worth saying, in the five numbers a player can act
 * on. Counts of each verdict are left out on purpose: they say the same thing
 * as the share, and three of them are harder to read than one. */
export type Summary = {
  readonly points: number;
  /** Share of the notes that were not missed, which reads like how much of the
   * song was got through. */
  readonly notes: number;
  readonly streak: number;
  /** The weighted share the rest of the app records a run by, where a good is
   * worth half a perfect. Kept beside `notes` because they answer different
   * questions and one column already stores this one. */
  readonly accuracy: number;
  /** Share of the held notes that were seen out. */
  readonly hold: number;
  /** How far from the beat a strike lands on average, in seconds, ignoring
   * which side of it. The number that comes down with practice. */
  readonly spread: number;
};

/** Ranks a run reads out as. Ordered best first, since the first one whose bar
 * is cleared is the one awarded. */
const ranks = [
  { rank: "S", notes: 0.98, spread: 0.035 },
  { rank: "A", notes: 0.92, spread: 0.06 },
  { rank: "B", notes: 0.82, spread: 0.09 },
  { rank: "C", notes: 0.65, spread: 0.13 },
] as const;

export const lowestRank = "D";

export function spreadOf(timing: readonly number[]): number {
  if (timing.length === 0) {
    return 0;
  }
  let total = 0;
  for (const away of timing) {
    total += Math.abs(away);
  }
  return total / timing.length;
}

export function summarise(
  score: Score,
  points: number,
  holds: HoldTally,
  timing: readonly number[],
): Summary {
  const judged = totalJudged(score);
  return {
    points,
    notes: judged === 0 ? 0 : (judged - score.missed) / judged,
    streak: score.bestCombo,
    accuracy: accuracy(score),
    hold: holdShare(holds),
    spread: spreadOf(timing),
  };
}

/** A run has to be both accurate and tidy to rank well, so a player cannot
 * mash their way to the top of one measure while ignoring the other. */
export function rankOf(summary: Summary): string {
  for (const bar of ranks) {
    if (summary.notes >= bar.notes && summary.spread <= bar.spread) {
      return bar.rank;
    }
  }
  return lowestRank;
}
