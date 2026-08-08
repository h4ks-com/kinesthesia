/** Past this a note is being held rather than struck, and the time beyond it is
 * worth points. Short, because holding is a thing to be rewarded wherever it
 * happens rather than a demand made of long notes. */
export const holdFrom = 0.2;

/** Points a second of holding is worth, on the scale a judged note is scored
 * on. Enough to be worth reaching for, far short of what playing the notes
 * pays, since holding is the flourish and the notes are the song. */
export const holdRate = 40;

/** How much of a note's end may be let go of before anyone is told. A key comes
 * up before the ear says it should, and calling that out on every note would
 * teach nothing. */
export const holdSlack = 0.25;

/** A note long enough that dropping it early is worth saying. Well above where
 * holding starts paying, so the reminder stays rare while the bonus is on
 * offer everywhere. */
export const worthSaying = 1.2;

/** Points earned for keeping a note down, from the moment it counts as held.
 * Nothing for a note let go before then, and nothing extra past its end: the
 * song stops asking once the note is over. */
export function holdBonus(length: number, held: number): number {
  const counted = Math.min(held, length) - holdFrom;
  return counted <= 0 ? 0 : Math.round(counted * holdRate);
}

/** Whether letting go here is worth telling the player about. Only a note long
 * enough to have been obviously held, dropped well before its end. */
export function droppedEarly(length: number, held: number): boolean {
  return length >= worthSaying && held < length * (1 - holdSlack);
}
