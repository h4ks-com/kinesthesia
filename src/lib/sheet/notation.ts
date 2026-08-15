import type { Spelling, Step } from "@/lib/sheet/spelling";
import { spellPitch } from "@/lib/sheet/spelling";
import type { SheetNote } from "@/lib/sheet/types";

/** Divisions per quarter note in the produced MusicXML, chosen to equal one
 * 16th note, so a "unit" below is directly the `<duration>` value. */
export const divisions = 4;

export type QuantizedNote = {
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
    quantized.push({ pitch: note.pitch, start, duration: end - start });
  }
  return quantized;
}

export type StaffEvent = {
  readonly start: number;
  readonly duration: number;
  /** Empty for a rest. */
  readonly pitches: readonly number[];
};

/** Reduces a staff's quantized notes to one monophonic-with-chords timeline
 * covering every unit from 0 to `totalUnits`, inserting rests for the gaps.
 * Notes sharing a start are stacked into a chord at the shortest of their
 * durations, so a simultaneous longer note is truncated to the chord rather
 * than smearing into whatever starts next; a note that merely overlaps one
 * already sounding, without sharing its start, is clipped to begin where the
 * earlier one ends, or dropped if nothing of it would remain. One voice per
 * staff for v1, so two genuinely independent overlapping lines are not both
 * kept: the later one simply takes over. */
export function sequenceStaff(
  notes: readonly QuantizedNote[],
  totalUnits: number,
): StaffEvent[] {
  const chordPitches = new Map<number, number[]>();
  const chordDuration = new Map<number, number>();
  for (const note of notes) {
    const pitches = chordPitches.get(note.start) ?? [];
    pitches.push(note.pitch);
    chordPitches.set(note.start, pitches);
    const shortest = Math.min(
      chordDuration.get(note.start) ?? note.duration,
      note.duration,
    );
    chordDuration.set(note.start, shortest);
  }

  const starts = [...chordPitches.keys()].sort((left, right) => left - right);
  const events: StaffEvent[] = [];
  let cursor = 0;
  for (const start of starts) {
    if (start > cursor) {
      events.push({ start: cursor, duration: start - cursor, pitches: [] });
      cursor = start;
    }
    const pitches = [...new Set(chordPitches.get(start) ?? [])].sort(
      (left, right) => right - left,
    );
    const duration = chordDuration.get(start) ?? 1;
    if (start < cursor) {
      const clipped = duration - (cursor - start);
      if (clipped <= 0) {
        continue;
      }
      events.push({ start: cursor, duration: clipped, pitches });
      cursor += clipped;
      continue;
    }
    events.push({ start, duration, pitches });
    cursor += duration;
  }
  if (cursor < totalUnits) {
    events.push({ start: cursor, duration: totalUnits - cursor, pitches: [] });
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
  readonly pitches: readonly number[];
  readonly durationUnits: number;
  /** Sound continues into a later chunk of the same original event. */
  readonly tieStart: boolean;
  /** Continues a tie from an earlier chunk of the same original event. */
  readonly tieStop: boolean;
  readonly staff: 1 | 2;
};

/** Splits a staff's events at measure boundaries, then further at standard
 * note values within a measure, tying every chunk of one original event back
 * together whichever boundary caused the split. */
export function buildInstructions(
  events: readonly StaffEvent[],
  measureUnits: number,
  staff: 1 | 2,
): NoteInstruction[] {
  const out: NoteInstruction[] = [];
  for (const event of events) {
    let pos = event.start;
    let remaining = event.duration;
    const values: { measureIndex: number; duration: number }[] = [];
    while (remaining > 0) {
      const measureIndex = Math.floor(pos / measureUnits);
      const offset = pos - measureIndex * measureUnits;
      const room = measureUnits - offset;
      const boundaryChunk = Math.min(remaining, room);
      for (const value of decomposeDuration(boundaryChunk)) {
        values.push({ measureIndex, duration: value });
      }
      pos += boundaryChunk;
      remaining -= boundaryChunk;
    }
    const isRest = event.pitches.length === 0;
    values.forEach((value, index) => {
      out.push({
        measureIndex: value.measureIndex,
        pitches: event.pitches,
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

  if (instruction.pitches.length === 0) {
    return (
      "<note><rest/>" +
      `<duration>${instruction.durationUnits}</duration>` +
      `<voice>${instruction.staff}</voice><type>${type}</type>${dotXml}` +
      `<staff>${instruction.staff}</staff></note>`
    );
  }
  return instruction.pitches
    .map((pitch, index) => {
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

function attributesXml(
  fifths: number,
  beats: number,
  beatType: number,
): string {
  return (
    `<attributes><divisions>${divisions}</divisions>` +
    `<key><fifths>${fifths}</fifths></key>` +
    `<time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time>` +
    "<staves>2</staves>" +
    '<clef number="1"><sign>G</sign><line>2</line></clef>' +
    '<clef number="2"><sign>F</sign><line>4</line></clef>' +
    "</attributes>"
  );
}

export type MusicXmlInput = {
  readonly title: string;
  readonly fifths: number;
  readonly beats: number;
  readonly beatType: number;
  readonly measureCount: number;
  readonly measureUnits: number;
  readonly treble: readonly NoteInstruction[];
  readonly bass: readonly NoteInstruction[];
  readonly table: readonly Spelling[];
  readonly signature: Readonly<Record<Step, number>>;
};

export function buildMusicXml(input: MusicXmlInput): string {
  const measures: string[] = [];
  for (let index = 0; index < input.measureCount; index += 1) {
    const trebleXml = input.treble
      .filter((instruction) => instruction.measureIndex === index)
      .map((instruction) => noteXml(instruction, input.table, input.signature))
      .join("");
    const bassXml = input.bass
      .filter((instruction) => instruction.measureIndex === index)
      .map((instruction) => noteXml(instruction, input.table, input.signature))
      .join("");
    const attributes =
      index === 0
        ? attributesXml(input.fifths, input.beats, input.beatType)
        : "";
    measures.push(
      `<measure number="${index + 1}">${attributes}${trebleXml}` +
        `<backup><duration>${input.measureUnits}</duration></backup>${bassXml}</measure>`,
    );
  }
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" ' +
    '"http://www.musicxml.org/dtds/partwise.dtd">\n' +
    '<score-partwise version="3.1">' +
    `<work><work-title>${escapeXml(input.title)}</work-title></work>` +
    '<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>' +
    `<part id="P1">${measures.join("")}</part>` +
    "</score-partwise>"
  );
}
