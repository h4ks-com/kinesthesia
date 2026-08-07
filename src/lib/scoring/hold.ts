/** Shorter than this a note is struck rather than held, and asking anyone to
 * keep a key down for it would be asking them to notice something they cannot
 * feel. */
export const holdFrom = 0.4;

/** How much of the end a player may let go of and still be counted as having
 * held it. A key comes up before the ear says it should, and a hold that only
 * counted at its full length would fail almost everybody. */
export const holdSlack = 0.15;

/** A note long enough to be worth holding. */
export function isHold(length: number): boolean {
  return length >= holdFrom;
}

/** The point a hold stops needing the key down. Past this the note is its own
 * ring rather than the player's work. */
export function holdSettled(length: number): number {
  return length * (1 - holdSlack);
}

export type HoldVerdict = "kept" | "letGo";

/** Whether a hold was seen out. Overholding is free: a key still down when the
 * note ends costs nothing, and only letting go early is worth saying. */
export function judgeHold(length: number, held: number): HoldVerdict {
  return held >= holdSettled(length) ? "kept" : "letGo";
}

export type HoldTally = {
  readonly kept: number;
  readonly letGo: number;
};

export const emptyHolds: HoldTally = { kept: 0, letGo: 0 };

export function tallyHold(tally: HoldTally, verdict: HoldVerdict): HoldTally {
  return verdict === "kept"
    ? { ...tally, kept: tally.kept + 1 }
    : { ...tally, letGo: tally.letGo + 1 };
}

/** How much of the holding a player saw through, 0 to 1. One where a song asked
 * for no holds at all, since nothing was dropped. */
export function holdShare(tally: HoldTally): number {
  const total = tally.kept + tally.letGo;
  return total === 0 ? 1 : tally.kept / total;
}
