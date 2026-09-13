import {
  bendSemitones,
  type ExpressionTrail,
  vibratoHz,
} from "@/lib/midi/expression";

/** How far a wheel at full travel throws a note, in white keys. Wider than the
 * two semitones it sounds, so the interval reads at a glance without the note
 * wandering into its neighbour's lane. */
const bendSpanKeys = bendSemitones * 0.675;
const vibratoWidth = 0.16;
/** Seconds between samples along a bent bar. */
const bendGrain = 1 / 30;
export const maxBendSteps = 140;

/** Which moment a height on the roll stands for. */
export type TimeAtHeight = (y: number) => number;

/** Reads a height as a moment. A falling note carries its future below the
 * line and a rising one carries its past above it, so the two read the same
 * bar in opposite directions. Taken off the wrong one, a bend is pinned to the
 * screen instead of to the note. */
export function momentAt(
  position: number,
  keyboardTop: number,
  scale: number,
  rising: boolean,
): TimeAtHeight {
  return (y) => position + ((keyboardTop - y) / scale) * (rising ? -1 : 1);
}

/** The bar as a stack of rows, each shifted by what the wheels were doing at
 * the moment that row stands for. */
export type BendRow = {
  readonly y: number;
  readonly offset: number;
};

/** The vertical run of a note on screen. Where it sits across the keyboard is
 * the caller's business: this only reads how far the bar reaches. */
export type NoteBar = {
  readonly top: number;
  readonly height: number;
};

/** The shape a note takes when the wheels moved under it, or null when they sat
 * still and it is drawn as a plain bar.
 *
 * Sampled at fixed moments rather than at a share of the bar. A held note grows
 * every frame, so spacing the samples along its height would move every one of
 * them to a new moment and recut the whole shape each frame. On the clock they
 * stay put, and the trace rides with the note. */
export function bentRows(
  trail: ExpressionTrail,
  track: number,
  timeAt: TimeAtHeight,
  bar: NoteBar,
  whiteWidth: number,
): readonly BendRow[] | null {
  const span = whiteWidth * bendSpanKeys;
  const wobble = whiteWidth * vibratoWidth;
  const from = timeAt(bar.top);
  const to = timeAt(bar.top + bar.height);
  const reach = to - from;

  const moments: number[] = [from];
  if (reach !== 0) {
    const early = Math.min(from, to);
    const late = Math.max(from, to);
    for (
      let at = Math.ceil(early / bendGrain) * bendGrain;
      at < late && moments.length < maxBendSteps;
      at += bendGrain
    ) {
      moments.push(at);
    }
    if (reach < 0) {
      moments.sort((first, second) => second - first);
    }
    moments.push(to);
  }

  const rows: BendRow[] = [];
  let moved = false;
  for (const when of moments) {
    const { bend, depth } = trail.at(track, when);
    const shimmer =
      depth === 0
        ? 0
        : Math.sin(when * vibratoHz * Math.PI * 2) * depth * wobble;
    const offset = bend * span + shimmer;
    if (offset !== 0) {
      moved = true;
    }
    const along = reach === 0 ? 0 : (when - from) / reach;
    rows.push({ y: bar.top + bar.height * along, offset });
  }

  return moved ? rows : null;
}
