import { goodWindow, lateWindow, perfectWindow } from "@/lib/scoring/judge";

/** How far either side of the beat the rail reaches. Everything a strike can be
 * judged at fits inside it, so a tick never has to be clamped to an end and
 * read as tighter than it was. */
export const railSpan = lateWindow;

/** Where a strike sits along the rail, 0 at the earliest it could be and 1 at
 * the latest, with 0.5 exactly on the beat. */
export function railPlace(away: number): number {
  const along = 0.5 + away / (railSpan * 2);
  return Math.min(1, Math.max(0, along));
}

/** How much of the rail a judgement covers, centred. A band is drawn from
 * `(1 - width) / 2`, so only the width is needed. */
export function railBand(window: number): number {
  return Math.min(1, window / railSpan);
}

export const perfectBand = railBand(perfectWindow);
export const goodBand = railBand(goodWindow);

/** The habit the last strikes add up to, or null before there are enough of
 * them to be reading a habit rather than a single hit. */
export const enoughForHabit = 4;

export function railMean(recent: readonly number[]): number | null {
  if (recent.length < enoughForHabit) {
    return null;
  }
  let total = 0;
  for (const away of recent) {
    total += away;
  }
  return total / recent.length;
}

/** How many columns the run's timing is counted into. Odd, so one of them sits
 * squarely on the beat rather than the beat falling on a seam. */
export const shapeColumns = 15;

/** Which column a strike belongs in. */
export function shapeColumn(away: number): number {
  const along = railPlace(away) * shapeColumns;
  return Math.min(shapeColumns - 1, Math.max(0, Math.floor(along)));
}

export const emptyShape: readonly number[] = Array.from(
  { length: shapeColumns },
  () => 0,
);
