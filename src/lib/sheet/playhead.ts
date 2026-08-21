import type { ScoreMark } from "@/lib/sheet/marks";

/** Later on the page: further down, or level with it and further across. Every
 * staff of a system shares that system's top, so reading down before across is
 * what tells two marks in the same system apart by the beat they fall on. */
function isAhead(candidate: ScoreMark, standing: ScoreMark): boolean {
  return (
    candidate.top > standing.top ||
    (candidate.top === standing.top && candidate.left > standing.left)
  );
}

/** Where the one reading bar stands once this moment is due. A moment sounds
 * in several parts at once and the grid can write them a hair apart, so the
 * furthest of them is where the reading is and the rest are behind it. */
export function nextPlayhead(
  standing: ScoreMark | null,
  ids: ReadonlySet<number>,
  marks: ReadonlyMap<number, readonly ScoreMark[]>,
  jumped: boolean,
): ScoreMark | null {
  let front: ScoreMark | null = null;
  for (const id of ids) {
    // Only where the note is struck: a tie is one note written in several
    // places and played once.
    const mark = marks.get(id)?.[0];
    if (mark !== undefined && (front === null || isAhead(mark, front))) {
      front = mark;
    }
  }
  if (front === null) {
    return standing;
  }
  if (jumped || standing === null) {
    return front;
  }
  return isAhead(front, standing) ? front : standing;
}

/** How far down the score a panel of this height is scrolled to hold the bar's
 * system. Centred, so a system of ten instruments is on screen whole. One
 * taller than the panel starts at its top, and the two cases meet
 * continuously, which is what keeps a tall chord from flipping the page
 * between placements. */
export function playheadScrollTarget(
  at: ScoreMark,
  viewHeight: number,
  contentHeight: number,
): number {
  const furthest = Math.max(0, contentHeight - viewHeight);
  const spare = Math.max(0, viewHeight - at.height);
  return Math.max(0, Math.min(furthest, at.top - spare / 2));
}

/** Exponential time constant for the eased catch-up scroll, so the page glides
 * from one system to the next as the music reaches them. */
const followTauMs = 220;

/** Where the scroll stands one frame later. The step is the frame the render is
 * laying down rather than a measured one, so the same song scrolls the same way
 * every time it is rendered. */
export function easedScroll(
  current: number,
  target: number,
  stepMs: number,
): number {
  return current + (target - current) * (1 - Math.exp(-stepMs / followTauMs));
}
