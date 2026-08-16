import type { Spelling, Step } from "@/lib/sheet/spelling";
import { spellPitch } from "@/lib/sheet/spelling";
import type { SheetNote } from "@/lib/sheet/types";

/** Divisions per quarter note in the produced MusicXML, chosen to equal one
 * 16th note, so a "unit" below is directly the `<duration>` value. */
export const divisions = 4;

export type QuantizedNote = {
  readonly id: number;
  readonly pitch: number;
  readonly start: number;
  readonly duration: number;
};

/** Snaps note starts and durations onto the 16th-note grid. Tempo changes are
 * not modelled: `bpm` is the single detected tempo, matching what the rest of
 * the converter treats as constant for v1. */
export function quantizeNotes(
  notes: readonly SheetNote[],
  bpm: number,
): QuantizedNote[] {
  const unitsPerSecond = (bpm / 60) * divisions;
  const quantized: QuantizedNote[] = [];
  for (const note of notes) {
    const start = Math.round(note.start * unitsPerSecond);
    const end = Math.max(
      start + 1,
      Math.round((note.start + note.duration) * unitsPerSecond),
    );
    quantized.push({
      id: note.id,
      pitch: note.pitch,
      start,
      duration: end - start,
    });
  }
  return quantized;
}

/** One written pitch of a chord and every source note it sounds for: more
 * than one where a doubled unison collapsed onto the same written pitch. */
export type ChordTone = {
  readonly pitch: number;
  readonly ids: readonly number[];
};

export type StaffEvent = {
  readonly start: number;
  readonly duration: number;
  /** Empty for a rest. */
  readonly tones: readonly ChordTone[];
};

function tonesOf(sounding: readonly QuantizedNote[]): ChordTone[] {
  const idsByPitch = new Map<number, number[]>();
  for (const note of sounding) {
    const ids = idsByPitch.get(note.pitch);
    if (ids === undefined) {
      idsByPitch.set(note.pitch, [note.id]);
    } else {
      ids.push(note.id);
    }
  }
  return [...idsByPitch.entries()]
    .sort(([left], [right]) => right - left)
    .map(([pitch, ids]) => ({ pitch, ids }));
}

/**
 * Reduces a staff's quantized notes to one timeline of chords and rests
 * covering every unit from 0 to `totalUnits`.
 *
 * A note the score never carries is a note the cursor can never stop on, which
 * is why every onset gets an event: on a real piano piece, dropping the ones
 * that overlap loses more than a third of them.
 */
export function sequenceStaff(
  notes: readonly QuantizedNote[],
  totalUnits: number,
): StaffEvent[] {
  if (notes.length === 0) {
    return [{ start: 0, duration: totalUnits, tones: [] }];
  }
  const onsets = [...new Set(notes.map((note) => note.start))].sort(
    (left, right) => left - right,
  );
  const bounds = [
    ...new Set([
      ...onsets,
      ...notes.map((note) => note.start + note.duration),
      totalUnits,
    ]),
  ]
    .filter((unit) => unit <= totalUnits)
    .sort((left, right) => left - right);

  // Swept rather than searched: the notes and the bounds are both in order, so
  // each note is admitted once as the cursor reaches it and dropped once as it
  // passes, which keeps a dense piece linear in its note count.
  const byStart = [...notes].sort((left, right) => left.start - right.start);
  const sounding: QuantizedNote[] = [];
  const events: StaffEvent[] = [];
  let admitted = 0;
  let cursor = 0;
  for (const bound of bounds) {
    if (bound <= cursor) {
      continue;
    }
    while (admitted < byStart.length) {
      const note = byStart[admitted];
      if (note === undefined || note.start > cursor) {
        break;
      }
      sounding.push(note);
      admitted += 1;
    }
    for (let index = sounding.length - 1; index >= 0; index -= 1) {
      const note = sounding[index];
      if (note !== undefined && note.start + note.duration <= cursor) {
        sounding.splice(index, 1);
      }
    }
    events.push({
      start: cursor,
      duration: bound - cursor,
      tones: tonesOf(sounding),
    });
    cursor = bound;
  }
  if (cursor < totalUnits) {
    events.push({
      start: cursor,
      duration: totalUnits - cursor,
      tones: [],
    });
  }
  return events;
}

/** Standard note values in 16th-note units, longest first, so a greedy
 * decomposition of an arbitrary quantized duration always terminates on 1. */
const standardValues = [16, 12, 8, 6, 4, 3, 2, 1] as const;

const typeByValue: Record<
  number,
  { readonly type: string; readonly dots: number }
> = {
  16: { type: "whole", dots: 0 },
  12: { type: "half", dots: 1 },
  8: { type: "half", dots: 0 },
  6: { type: "quarter", dots: 1 },
  4: { type: "quarter", dots: 0 },
  3: { type: "eighth", dots: 1 },
  2: { type: "eighth", dots: 0 },
  1: { type: "16th", dots: 0 },
};

/** Breaks an arbitrary duration into standard (optionally dotted) note
 * values, greedily. Not tie-minimal for every duration, which is the
 * documented trade-off of a simple greedy scheme rather than an engraving
 * algorithm. */
export function decomposeDuration(units: number): number[] {
  const chunks: number[] = [];
  let remaining = units;
  while (remaining > 0) {
    const value =
      standardValues.find((candidate) => candidate <= remaining) ?? 1;
    chunks.push(value);
    remaining -= value;
  }
  return chunks;
}

export type NoteInstruction = {
  readonly measureIndex: number;
  /** Offset within the measure, in the same 16th-note units as the grid. */
  readonly positionInMeasure: number;
  readonly tones: readonly ChordTone[];
  readonly durationUnits: number;
  /** Sound continues into a later chunk of the same original event. */
  readonly tieStart: boolean;
  /** Continues a tie from an earlier chunk of the same original event. */
  readonly tieStop: boolean;
  readonly staff: 1 | 2;
};

/** Splits a staff's events at measure boundaries, then further at standard
 * note values within a measure, tying every chunk of one original event back
 * together whichever boundary caused the split. Every chunk keeps the tones
 * (and so the source ids) of the event it was split from, which is what lets
 * a note tied across a barline be found by identity on whichever chunk is on
 * screen. */
export function buildInstructions(
  events: readonly StaffEvent[],
  measureUnits: number,
  staff: 1 | 2,
): NoteInstruction[] {
  const out: NoteInstruction[] = [];
  for (const event of events) {
    let pos = event.start;
    let remaining = event.duration;
    const values: {
      measureIndex: number;
      positionInMeasure: number;
      duration: number;
    }[] = [];
    while (remaining > 0) {
      const measureIndex = Math.floor(pos / measureUnits);
      const offset = pos - measureIndex * measureUnits;
      const room = measureUnits - offset;
      const boundaryChunk = Math.min(remaining, room);
      let withinBoundary = offset;
      for (const value of decomposeDuration(boundaryChunk)) {
        values.push({
          measureIndex,
          positionInMeasure: withinBoundary,
          duration: value,
        });
        withinBoundary += value;
      }
      pos += boundaryChunk;
      remaining -= boundaryChunk;
    }
    const isRest = event.tones.length === 0;
    values.forEach((value, index) => {
      out.push({
        measureIndex: value.measureIndex,
        positionInMeasure: value.positionInMeasure,
        tones: event.tones,
        durationUnits: value.duration,
        tieStart: !isRest && index < values.length - 1,
        tieStop: !isRest && index > 0,
        staff,
      });
    });
  }
  return out;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function accidentalName(alter: number): string | null {
  switch (alter) {
    case 1:
      return "sharp";
    case -1:
      return "flat";
    case 2:
      return "double-sharp";
    case -2:
      return "flat-flat";
    default:
      return null;
  }
}

/** Prints an accidental only where a note's alteration differs from what the
 * key signature already implies for its letter, the way engraved notation
 * does, rather than marking every altered note regardless of context. */
function accidentalFor(alter: number, implied: number): string | null {
  if (alter === implied) {
    return null;
  }
  return alter === 0 ? "natural" : accidentalName(alter);
}

function noteXml(
  instruction: NoteInstruction,
  table: readonly Spelling[],
  signature: Readonly<Record<Step, number>>,
): string {
  const { type, dots } = typeByValue[instruction.durationUnits] ?? {
    type: "quarter",
    dots: 0,
  };
  const dotXml = "<dot/>".repeat(dots);
  const tieXml =
    (instruction.tieStop ? '<tie type="stop"/>' : "") +
    (instruction.tieStart ? '<tie type="start"/>' : "");
  const tiedXml =
    (instruction.tieStop ? '<tied type="stop"/>' : "") +
    (instruction.tieStart ? '<tied type="start"/>' : "");
  const notationsXml =
    tiedXml === "" ? "" : `<notations>${tiedXml}</notations>`;

  if (instruction.tones.length === 0) {
    return (
      "<note><rest/>" +
      `<duration>${instruction.durationUnits}</duration>` +
      `<voice>${instruction.staff}</voice><type>${type}</type>${dotXml}` +
      `<staff>${instruction.staff}</staff></note>`
    );
  }
  return instruction.tones
    .map(({ pitch }, index) => {
      const spelled = spellPitch(pitch, table);
      const chordXml = index === 0 ? "" : "<chord/>";
      const alterXml =
        spelled.alter === 0 ? "" : `<alter>${spelled.alter}</alter>`;
      const accidental = accidentalFor(
        spelled.alter,
        signature[spelled.step] ?? 0,
      );
      const accidentalXml =
        accidental === null ? "" : `<accidental>${accidental}</accidental>`;
      return (
        `<note>${chordXml}<pitch><step>${spelled.step}</step>${alterXml}` +
        `<octave>${spelled.octave}</octave></pitch>` +
        `<duration>${instruction.durationUnits}</duration>${tieXml}` +
        `<voice>${instruction.staff}</voice><type>${type}</type>${dotXml}` +
        `${accidentalXml}<staff>${instruction.staff}</staff>${notationsXml}</note>`
      );
    })
    .join("");
}

export type StaffClef = "treble" | "bass";

const clefSigns: Readonly<Record<StaffClef, { sign: string; line: number }>> = {
  treble: { sign: "G", line: 2 },
  bass: { sign: "F", line: 4 },
};

function clefXml(clef: StaffClef, staff: number): string {
  const { sign, line } = clefSigns[clef];
  return `<clef number="${staff}"><sign>${sign}</sign><line>${line}</line></clef>`;
}

function attributesXml(
  fifths: number,
  beats: number,
  beatType: number,
  clefs: readonly StaffClef[],
): string {
  return (
    `<attributes><divisions>${divisions}</divisions>` +
    `<key><fifths>${fifths}</fifths></key>` +
    `<time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time>` +
    `<staves>${clefs.length}</staves>` +
    clefs.map((clef, index) => clefXml(clef, index + 1)).join("") +
    "</attributes>"
  );
}

/** One line of the written score: a single staff for an instrument, or the two
 * of a grand staff, whose instructions carry the staff they belong to. */
export type MusicXmlPart = {
  readonly name: string;
  readonly clefs: readonly StaffClef[];
  readonly instructions: readonly NoteInstruction[];
};

export type MusicXmlInput = {
  readonly title: string;
  readonly fifths: number;
  readonly beats: number;
  readonly beatType: number;
  readonly measureCount: number;
  readonly measureUnits: number;
  readonly parts: readonly MusicXmlPart[];
  readonly table: readonly Spelling[];
  readonly signature: Readonly<Record<Step, number>>;
};

function partXml(part: MusicXmlPart, input: MusicXmlInput): string {
  const measures: string[] = [];
  for (let index = 0; index < input.measureCount; index += 1) {
    const staves = part.clefs.map((_clef, staffIndex) =>
      part.instructions
        .filter(
          (instruction) =>
            instruction.measureIndex === index &&
            instruction.staff === staffIndex + 1,
        )
        .map((instruction) =>
          noteXml(instruction, input.table, input.signature),
        )
        .join(""),
    );
    const attributes =
      index === 0
        ? attributesXml(input.fifths, input.beats, input.beatType, part.clefs)
        : "";
    const backup = `<backup><duration>${input.measureUnits}</duration></backup>`;
    measures.push(
      `<measure number="${index + 1}">${attributes}${staves.join(backup)}</measure>`,
    );
  }
  return measures.join("");
}

export function buildMusicXml(input: MusicXmlInput): string {
  const listed = input.parts
    .map(
      (part, index) =>
        `<score-part id="P${index + 1}"><part-name>${escapeXml(part.name)}</part-name></score-part>`,
    )
    .join("");
  const written = input.parts
    .map(
      (part, index) =>
        `<part id="P${index + 1}">${partXml(part, input)}</part>`,
    )
    .join("");
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" ' +
    '"http://www.musicxml.org/dtds/partwise.dtd">\n' +
    '<score-partwise version="3.1">' +
    `<work><work-title>${escapeXml(input.title)}</work-title></work>` +
    `<part-list>${listed}</part-list>` +
    written +
    "</score-partwise>"
  );
}
