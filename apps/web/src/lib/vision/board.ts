import { keyUnits } from "keybed";
import { highestPitch, lowestPitch } from "@/lib/midi/song";
import type { Point } from "@/lib/vision/placement";
import type { PitchRange, Stage } from "@/lib/vision/space";

/** A frame to read, as a canvas hands it over. */
export type Picture = {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
};

export type BoardRead =
  | {
      readonly kind: "read";
      readonly range: PitchRange;
      /** Share of the readable samples whose colour matched the board found. */
      readonly agreement: number;
    }
  | { readonly kind: "unsure"; readonly reason: string };

/** How many points are read across the keys. A board of sixty white keys still
 * gets several samples to a key. */
const samples = 480;

/** Where the samples are taken, as shares of the keybed's depth from its far
 * edge: three lines over the black keys, and one on white surface no black key
 * can reach, which is what every other reading is judged against. */
const overBlacks = [0.22, 0.3, 0.38];
const overWhites = 0.88;

/** Darker than this share of the white surface beside it, a sample is reading a
 * black key. Ink and paint vary, and so does the light across a room, so the
 * test is a ratio rather than a level. */
const blackBelow = 0.72;

/** How much of the board has to agree before its keys are worth drawing. */
const leastAgreement = 0.78;

/** The keyboards worth considering, in white keys: an octave and a half up to a
 * full concert board with room to spare. */
const fewestWhites = 12;
const mostWhites = 56;

/** The pattern of black keys cannot settle which octave the board sits in,
 * since every C reads exactly like the next one up. Of the octaves that fit, we
 * take the one that leaves the board centred where a full piano is centred. */
const pianoCentre = (lowestPitch + highestPitch) / 2;

const whitePitches: readonly number[] = buildWhites();
const octaveDark: Uint8Array = buildOctave();
const octaveSteps = 100;

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

/** Where the black keys fall inside one octave of seven white keys. The pattern
 * repeats every seven white widths, so one octave answers for a whole board. */
function buildOctave(): Uint8Array {
  const dark = new Uint8Array(7 * 100);
  for (let pitch = 60; pitch < 72; pitch += 1) {
    const units = keyUnits(pitch);
    if (units.to - units.from === 1) {
      continue;
    }
    const from = Math.round(units.from * 100);
    const to = Math.round(units.to * 100);
    for (let at = from; at < to; at += 1) {
      dark[((at % dark.length) + dark.length) % dark.length] = 1;
    }
  }
  return dark;
}

function isDarkAt(units: number): boolean {
  const at = Math.round(units * octaveSteps);
  return (
    octaveDark[
      ((at % octaveDark.length) + octaveDark.length) % octaveDark.length
    ] === 1
  );
}

function brightnessAt(picture: Picture, point: Point | null): number | null {
  if (point === null) {
    return null;
  }
  const x = Math.round(point.x);
  const y = Math.round(point.y);
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

/** What the camera reads across the keys: true where a black key covers the
 * sample, null where the picture has nothing to say. */
function readStripe(stage: Stage, picture: Picture): (boolean | null)[] {
  const stripe: (boolean | null)[] = [];
  for (let index = 0; index < samples; index += 1) {
    const along = (index + 0.5) / samples;
    const white = brightnessAt(picture, stage.onKeys(along, overWhites));
    let dark = 0;
    let taken = 0;
    for (const across of overBlacks) {
      const value = brightnessAt(picture, stage.onKeys(along, across));
      if (value !== null) {
        dark += value;
        taken += 1;
      }
    }
    stripe.push(
      white === null || white <= 0 || taken === 0
        ? null
        : dark / taken < white * blackBelow,
    );
  }
  return stripe;
}

function agreementOf(
  stripe: readonly (boolean | null)[],
  start: number,
  whites: number,
): number {
  let matched = 0;
  let known = 0;
  for (const [index, seen] of stripe.entries()) {
    if (seen === null) {
      continue;
    }
    known += 1;
    const units = start + ((index + 0.5) / stripe.length) * whites;
    if (isDarkAt(units) === seen) {
      matched += 1;
    }
  }
  return known === 0 ? 0 : matched / known;
}

/** Which keyboard is in front of the camera, read off the black keys. The count
 * of keys comes out of how often the pattern repeats across the keybed, and
 * which note it starts on out of where the pattern sits.
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
  const stripe = readStripe(stage, picture);
  if (stripe.filter((seen) => seen !== null).length < samples / 2) {
    return { kind: "unsure", reason: "the keys are not in the picture" };
  }
  let best: { range: PitchRange; agreement: number } | null = null;
  for (const [index, lowest] of whitePitches.entries()) {
    const start = keyUnits(lowest).from;
    for (let whites = fewestWhites; whites <= mostWhites; whites += 1) {
      const highest = whitePitches[index + whites - 1];
      if (highest === undefined) {
        break;
      }
      const range = { lowest, highest };
      if (
        played !== null &&
        (played.lowest < lowest || played.highest > highest)
      ) {
        continue;
      }
      const agreement = agreementOf(stripe, start, whites);
      if (best === null || agreement > best.agreement) {
        best = { range, agreement };
        continue;
      }
      if (
        agreement > best.agreement - 0.02 &&
        nearerMiddle(range, best.range)
      ) {
        best = { range, agreement: best.agreement };
      }
    }
  }
  if (best === null || best.agreement < leastAgreement) {
    return {
      kind: "unsure",
      reason: "the black keys do not read as a keyboard",
    };
  }
  return { kind: "read", range: best.range, agreement: best.agreement };
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
