import { keyUnits } from "keybed";
import { highestPitch, lowestPitch } from "@/lib/midi/song";
import type { Point } from "@/lib/vision/placement";
import { type PitchRange, type Stage, spanInKeys } from "@/lib/vision/space";

/** A frame to read, as a canvas hands it over. It can be smaller than the frame
 * the stage projects into, since reading colour off the keys needs nothing like
 * the detail the picture on screen does. */
export type Picture = {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
  /** How much of the frame's size this picture is. */
  readonly scale: number;
};

export type BoardRead =
  | {
      readonly kind: "read";
      readonly range: PitchRange;
      /** Share of the readable samples whose colour matched the board found. */
      readonly agreement: number;
      /** Share of the samples that came back dark, and how deep into the keybed
       * they were taken. A keyboard reads about two fifths dark. */
      readonly darkShare: number;
      readonly depth: number;
    }
  | { readonly kind: "unsure"; readonly reason: string };

/** How many points are read across the keys. A board of sixty white keys still
 * gets several samples to a key. */
const samples = 360;

/** How deep into the keybed the black keys are read, as shares of its depth
 * from the far edge. Where the detector puts that edge varies with the
 * instrument's own panel, so every depth is tried and the one that reads most
 * like a keyboard is kept. */
const blackDepths = [0.18, 0.26, 0.34, 0.42, 0.5];

/** How many pixels of picture a key has to cover before its colour means
 * anything. The far end of a keybed seen at an angle is compressed to nothing,
 * and a smear of black and white there reads as solid black. */
const leastPixelsPerKey = 3;

/** How the keys are split into black and white: each stretch of the board is
 * read on its own, since light falls unevenly across a room, and a stretch
 * whose two colours do not separate is one where the black keys have hidden the
 * white between them, which says nothing about where the keys are. */
const stretches = 6;
const leastSeparation = 0.4;

/** How much of the board has to agree before its keys are worth drawing. The
 * hands cover some of it, a phone camera smears the far end of it, and a board
 * read a little wrong still shows the reader what to correct. */
const leastAgreement = 0.62;

/** The keyboards worth considering, in white keys: an octave and a half up to a
 * full concert board with room to spare. */
const fewestWhites = 12;
const mostWhites = 56;

/** The pattern of black keys cannot settle which octave the board sits in,
 * since every C reads exactly like the next one up. Of the octaves that fit, we
 * take the one that leaves the board centred where a full piano is centred. */
const pianoCentre = (lowestPitch + highestPitch) / 2;

/** How far a black key spreads over the white beside it in the picture. Black
 * keys stand above the white ones, so seen from anywhere but straight above
 * they hide some of the white behind them, by an amount that depends on where
 * the camera is. It is fitted rather than assumed. */
const bleeds = [0, 0.1, 0.2, 0.3, 0.4];

const whitePitches: readonly number[] = buildWhites();
const octaveSteps = 100;
const octaveWide = 7 * octaveSteps;
const octaves = new Map<number, Uint8Array>();

function buildWhites(): number[] {
  const whites: number[] = [];
  for (let pitch = 12; pitch <= 120; pitch += 1) {
    const units = keyUnits(pitch);
    if (units.to - units.from === 1) {
      whites.push(pitch);
    }
  }
  return whites;
}

/** Where the black keys fall inside one octave of seven white keys, each spread
 * by what the camera cannot see past. The pattern repeats every seven white
 * widths, so one octave answers for a whole board. */
function darkOctave(bleed: number): Uint8Array {
  const held = octaves.get(bleed);
  if (held !== undefined) {
    return held;
  }
  const dark = new Uint8Array(octaveWide);
  for (let pitch = 60; pitch < 72; pitch += 1) {
    const units = keyUnits(pitch);
    if (units.to - units.from === 1) {
      continue;
    }
    const from = Math.round((units.from - bleed) * octaveSteps);
    const to = Math.round((units.to + bleed) * octaveSteps);
    for (let at = from; at < to; at += 1) {
      dark[((at % octaveWide) + octaveWide) % octaveWide] = 1;
    }
  }
  octaves.set(bleed, dark);
  return dark;
}

/** Where to cut one stretch of readings into dark and light, and how far apart
 * the two came out. Otsu's split: the cut that leaves the two sides furthest
 * apart, which on a keybed is the cut between the black keys and the white. */
function split(level: readonly number[]): {
  readonly at: number;
  readonly separation: number;
} {
  const bins = 64;
  const counts = new Array<number>(bins).fill(0);
  for (const value of level) {
    const bin = Math.min(
      bins - 1,
      Math.max(0, Math.floor((value / 256) * bins)),
    );
    counts[bin] = (counts[bin] ?? 0) + 1;
  }
  const total = level.length;
  let sum = 0;
  for (const [bin, count] of counts.entries()) {
    sum += bin * count;
  }
  let behind = 0;
  let behindSum = 0;
  let best = { at: 0, separation: 0 };
  let spread = 0;
  for (const [bin, count] of counts.entries()) {
    behind += count;
    if (behind === 0 || behind === total) {
      continue;
    }
    behindSum += bin * count;
    const ahead = total - behind;
    const between =
      (behind / total) *
      (ahead / total) *
      (behindSum / behind - (sum - behindSum) / ahead) ** 2;
    if (between > spread) {
      spread = between;
      best = { at: ((bin + 1) / bins) * 256, separation: 0 };
    }
  }
  const mean = sum / total;
  let variance = 0;
  for (const [bin, count] of counts.entries()) {
    variance += ((bin - mean) ** 2 * count) / total;
  }
  return {
    at: best.at,
    separation: variance === 0 ? 0 : spread / variance,
  };
}

function brightnessAt(picture: Picture, point: Point | null): number | null {
  if (point === null) {
    return null;
  }
  const x = Math.round(point.x * picture.scale);
  const y = Math.round(point.y * picture.scale);
  if (x < 1 || y < 1 || x >= picture.width - 1 || y >= picture.height - 1) {
    return null;
  }
  let total = 0;
  for (const [dx, dy] of [
    [0, 0],
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ]) {
    const at = ((y + (dy ?? 0)) * picture.width + x + (dx ?? 0)) * 4;
    total +=
      0.299 * (picture.data[at] ?? 0) +
      0.587 * (picture.data[at + 1] ?? 0) +
      0.114 * (picture.data[at + 2] ?? 0);
  }
  return total / 5;
}

type Stripe = {
  readonly seen: readonly (boolean | null)[];
  readonly darkShare: number;
  readonly depth: number;
};

/** What the camera reads across the keys at one depth: true where a black key
 * covers the sample, null where the picture has nothing to say. */
function readStripe(stage: Stage, picture: Picture, depth: number): Stripe {
  const line: (Point | null)[] = [];
  for (let index = 0; index < samples; index += 1) {
    line.push(stage.onKeys((index + 0.5) / samples, depth));
  }
  const perSample = spanInKeys / samples;
  const level = line.map((point, index) => {
    const before = line[Math.max(0, index - 1)];
    const after = line[Math.min(line.length - 1, index + 1)];
    if (point === null || before == null || after == null) {
      return null;
    }
    const step =
      (Math.hypot(after.x - before.x, after.y - before.y) * picture.scale) /
      (2 * perSample);
    return step < leastPixelsPerKey ? null : brightnessAt(picture, point);
  });
  const seen: (boolean | null)[] = new Array<boolean | null>(samples).fill(
    null,
  );
  let dark = 0;
  let known = 0;
  const wide = Math.ceil(samples / stretches);
  for (let from = 0; from < samples; from += wide) {
    const stretch = level.slice(from, from + wide);
    const read = stretch.flatMap((value) => (value === null ? [] : [value]));
    if (read.length < wide / 2) {
      continue;
    }
    const cut = split(read);
    if (cut.separation < leastSeparation) {
      continue;
    }
    for (const [index, value] of stretch.entries()) {
      if (value === null) {
        continue;
      }
      const black = value < cut.at;
      seen[from + index] = black;
      known += 1;
      if (black) {
        dark += 1;
      }
    }
  }
  return { seen, darkShare: known === 0 ? 0 : dark / known, depth };
}

/** How much of a reading a keyboard of this many white keys, starting this far
 * into an octave, explains. */
function agreementOf(
  stripe: readonly (boolean | null)[],
  phase: number,
  whites: number,
  dark: Uint8Array,
): number {
  let matched = 0;
  let known = 0;
  for (const [index, seen] of stripe.entries()) {
    if (seen === null) {
      continue;
    }
    known += 1;
    const units = phase + ((index + 0.5) / stripe.length) * whites;
    const at = Math.round(units * octaveSteps);
    const expected = dark[((at % octaveWide) + octaveWide) % octaveWide] === 1;
    if (expected === seen) {
      matched += 1;
    }
  }
  return known === 0 ? 0 : matched / known;
}

type Shape = {
  /** White keys across the board. */
  readonly whites: number;
  /** Where its lowest key sits inside an octave, in white keys from a C. */
  readonly phase: number;
  readonly bleed: number;
  readonly agreement: number;
};

/** The board's size and where it starts, which is all colour can say: one C
 * reads exactly like the next. */
function bestShape(stripe: Stripe, played: PitchRange | null): Shape | null {
  let best: Shape | null = null;
  for (const bleed of bleeds) {
    const dark = darkOctave(bleed);
    for (let whites = fewestWhites; whites <= mostWhites; whites += 1) {
      for (let phase = 0; phase < 7; phase += 1) {
        const shape = { whites, phase, bleed, agreement: 0 };
        if (boardOfShape(shape, played) === null) {
          continue;
        }
        const agreement = agreementOf(stripe.seen, phase, whites, dark);
        if (best === null || agreement > best.agreement) {
          best = { whites, phase, bleed, agreement };
        }
      }
    }
  }
  return best;
}

/** Which keyboard of that shape it is. Every octave fits the colour equally, so
 * the notes already played must fit inside it, and of those that do we take the
 * one that leaves the board centred where a full piano is centred. */
function boardOfShape(
  shape: Shape,
  played: PitchRange | null,
): PitchRange | null {
  let best: PitchRange | null = null;
  for (const [index, lowest] of whitePitches.entries()) {
    const highest = whitePitches[index + shape.whites - 1];
    if (highest === undefined) {
      break;
    }
    if (
      ((keyUnits(lowest).from % 7) + 7) % 7 !== shape.phase ||
      (played !== null && (played.lowest < lowest || played.highest > highest))
    ) {
      continue;
    }
    const range = { lowest, highest };
    if (best === null || nearerMiddle(range, best)) {
      best = range;
    }
  }
  return best;
}

/** Which keyboard is in front of the camera, read off its black keys. The count
 * of keys comes out of how often the pattern repeats across the keybed, and
 * which note it starts on out of where the pattern sits.
 *
 * Where to read it is measured too. Seen from a low angle the black keys hide
 * the white between them at the back of the keybed, and an instrument whose
 * panel the detector took for keys shifts every depth, so each is tried and the
 * one a keyboard explains best is kept.
 *
 * Colour cannot tell one octave from another, since one C reads exactly like
 * the next, so every note the player has already sounded narrows it: the board
 * has to be able to play them. What is left over is settled by taking the
 * octave that leaves the board centred where a full piano is centred. */
export function readBoard(
  stage: Stage,
  picture: Picture,
  played: PitchRange | null = null,
): BoardRead {
  let best: { shape: Shape; stripe: Stripe } | null = null;
  let readable = false;
  const tried: string[] = [];
  for (const depth of blackDepths) {
    const stripe = readStripe(stage, picture, depth);
    if (stripe.seen.filter((seen) => seen !== null).length < samples / 6) {
      continue;
    }
    readable = true;
    const shape = bestShape(stripe, played);
    tried.push(
      `${depth}: ${percent(shape?.agreement ?? 0)} over ${shape?.whites ?? 0} keys, ${percent(stripe.darkShare)} dark`,
    );
    if (
      shape !== null &&
      (best === null || shape.agreement > best.shape.agreement)
    ) {
      best = { shape, stripe };
    }
  }
  if (!readable) {
    return { kind: "unsure", reason: "the keys are not in the picture" };
  }
  const range = best === null ? null : boardOfShape(best.shape, played);
  if (
    best === null ||
    range === null ||
    best.shape.agreement < leastAgreement
  ) {
    return {
      kind: "unsure",
      reason: `the black keys read as a keyboard only ${percent(best?.shape.agreement ?? 0)} of the way (${tried.join("; ")})`,
    };
  }
  return {
    kind: "read",
    range,
    agreement: best.shape.agreement,
    darkShare: best.stripe.darkShare,
    depth: best.stripe.depth,
  };
}

function percent(share: number): string {
  return `${(share * 100).toFixed(0)}%`;
}

function middleOf(range: PitchRange): number {
  return (range.lowest + range.highest) / 2;
}

function nearerMiddle(one: PitchRange, other: PitchRange): boolean {
  return (
    Math.abs(middleOf(one) - pianoCentre) <
    Math.abs(middleOf(other) - pianoCentre)
  );
}
