import { Key } from "tonal";
import type { Mode } from "@/lib/midi/analysis";

export type Step = "A" | "B" | "C" | "D" | "E" | "F" | "G";

export type Spelling = {
  readonly step: Step;
  readonly alter: number;
};

export type KeySpelling = {
  readonly table: readonly Spelling[];
  /** Sharps positive, flats negative, for the MusicXML `<fifths>` element. */
  readonly fifths: number;
  /** Alteration each step letter carries from the key signature alone, so a
   * note only needs a printed accidental where it differs from this. */
  readonly signature: Readonly<Record<Step, number>>;
};

const naturalPitch: Record<Step, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

const noteNamePattern = /^([A-G])(#*|b*)$/;

function parseNoteName(name: string): Spelling {
  const match = noteNamePattern.exec(name);
  const step = (match?.[1] ?? "C") as Step;
  const accidental = match?.[2] ?? "";
  const alter =
    accidental === ""
      ? 0
      : accidental[0] === "#"
        ? accidental.length
        : -accidental.length;
  return { step, alter };
}

function pitchClassOf(spelling: Spelling): number {
  return (((naturalPitch[spelling.step] + spelling.alter) % 12) + 12) % 12;
}

type KeyFacts = {
  readonly scale: readonly string[];
  readonly fifths: number;
  readonly keySignature: string;
};

function keyFacts(tonic: string, mode: Mode): KeyFacts {
  if (mode === "minor") {
    const key = Key.minorKey(tonic);
    return {
      scale: key.natural.scale,
      fifths: key.alteration,
      keySignature: key.keySignature,
    };
  }
  const key = Key.majorKey(tonic);
  return {
    scale: key.scale,
    fifths: key.alteration,
    keySignature: key.keySignature,
  };
}

/** A step letter's own unaltered pitch class, where that letter is used
 * elsewhere in the scale at a different alteration: cancelling the key
 * signature's accidental this way (e.g. B natural in a key signed with Bb)
 * reads far more naturally than borrowing a neighbour's letter, so it takes
 * priority over the general borrowing rule below. */
function naturalCancellation(
  pc: number,
  signature: Readonly<Record<Step, number>>,
): Step | null {
  for (const step of Object.keys(naturalPitch) as Step[]) {
    if (naturalPitch[step] === pc && signature[step] !== 0) {
      return step;
    }
  }
  return null;
}

/** One spelling per pitch class 0-11: the seven diatonic notes come straight
 * from the key's own scale. A chromatic note that lands on an altered scale
 * degree's own natural cancels that alteration (see `naturalCancellation`);
 * every other chromatic note borrows the letter of the diatonic neighbour a
 * semitone away, sharped from below in a sharp key and flatted from above in
 * a flat key. This is a fixed convention rather than a contextual analysis,
 * so an unusual key can read with more accidentals than a human engraver
 * would choose; getting every chromatic note "right" needs full melodic
 * spelling analysis, out of scope for v1. */
export function keySpelling(tonic: string, mode: Mode): KeySpelling {
  const { scale, fifths, keySignature } = keyFacts(tonic, mode);
  const sharps = !keySignature.startsWith("b");

  const table = new Array<Spelling | null>(12).fill(null);
  const signature: Record<Step, number> = {
    A: 0,
    B: 0,
    C: 0,
    D: 0,
    E: 0,
    F: 0,
    G: 0,
  };
  for (const name of scale) {
    const spelling = parseNoteName(name);
    table[pitchClassOf(spelling)] = spelling;
    signature[spelling.step] = spelling.alter;
  }
  for (let pc = 0; pc < 12; pc += 1) {
    if (table[pc] !== null) {
      continue;
    }
    const cancelled = naturalCancellation(pc, signature);
    if (cancelled !== null) {
      table[pc] = { step: cancelled, alter: 0 };
      continue;
    }
    const neighbourPc = sharps ? (pc - 1 + 12) % 12 : (pc + 1) % 12;
    const neighbour = table[neighbourPc];
    table[pc] =
      neighbour === null || neighbour === undefined
        ? { step: "C", alter: 0 }
        : { step: neighbour.step, alter: neighbour.alter + (sharps ? 1 : -1) };
  }
  return {
    table: table.map((entry) => entry ?? { step: "C", alter: 0 }),
    fifths,
    signature,
  };
}

export function spellPitch(
  pitch: number,
  table: readonly Spelling[],
): { step: Step; alter: number; octave: number } {
  const pc = ((pitch % 12) + 12) % 12;
  const spelling = table[pc] ?? { step: "C" as Step, alter: 0 };
  return { ...spelling, octave: Math.floor(pitch / 12) - 1 };
}
