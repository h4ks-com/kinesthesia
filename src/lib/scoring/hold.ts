import { lateWindow } from "@/lib/scoring/judge";

/** Past this a note is being held rather than struck, and the time beyond it is
 * worth points. Short, so holding is rewarded wherever it happens. */
export const holdFrom = 0.2;

/** Points a second of holding is worth, on the scale a judged note is scored
 * on. Enough to be worth reaching for, far short of what playing the notes
 * pays. */
export const holdRate = 40;

/** How much of a note's end may be let go of before anyone is told. A key comes
 * up before the ear says it should, and calling that out on every note would
 * teach nothing. */
export const holdSlack = 0.25;

/** A note long enough that dropping it early is worth saying. A hold is
 * measured from the strike, so a player who strikes at the deadline and holds
 * to the note's real end is `lateWindow` short of its length: anything below
 * this would scold them for it. */
export const worthSaying = lateWindow / holdSlack;

/** Points earned for keeping a note down, from the moment it counts as held.
 * Nothing for a note let go before then, and nothing past its length. */
export function holdBonus(length: number, held: number): number {
  const counted = Math.min(held, length) - holdFrom;
  return counted <= 0 ? 0 : Math.round(counted * holdRate);
}

/** Whether letting go here is worth telling the player about. Only a note long
 * enough to have been obviously held, dropped well before its end. */
export function droppedEarly(length: number, held: number): boolean {
  return length >= worthSaying && held < length * (1 - holdSlack);
}
