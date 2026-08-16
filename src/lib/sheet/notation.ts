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

/** How many voices one staff carries, which is what engravers set. A fifth
 * simultaneous line has nowhere of its own to go, so it joins the nearest
 * voice and cuts that voice's held note short where it starts. */
export const voicesPerStaff = 4;

/** MusicXML numbers voices per part, so the second staff continues where the
 * first leaves off: staff 1 owns 1..4 and staff 2 owns 5..8. */
export function voiceNumber(staff: 1 | 2, index: number): number {
  return (staff - 1) * voicesPerStaff + index + 1;
}

/** The voice the staff's rests are written in. The others fill their silence
 * with `<forward>`, since a rest per voice per gap buries the notes. */
export function isPrimaryVoice(voice: number): boolean {
  return (voice - 1) % voicesPerStaff === 0;
}

type OpenEvent = {
  start: number;
  duration: number;
  tones: ChordTone[];
};

function topPitch(event: OpenEvent): number {
  return event.tones[0]?.pitch ?? 0;
}

function endOf(voice: readonly OpenEvent[]): number {
  const last = voice.at(-1);
  return last === undefined ? 0 : last.start + last.duration;
}

/** Notes struck together and released together are one chord: one stem, one
 * written duration. Differing releases are what separates voices below. */
function chordGroups(notes: readonly QuantizedNote[]): OpenEvent[] {
  const groups = new Map<string, QuantizedNote[]>();
  for (const note of notes) {
    const key = `${note.start}:${note.duration}`;
    const list = groups.get(key);
    if (list === undefined) {
      groups.set(key, [note]);
    } else {
      list.push(note);
    }
  }
  return [...groups.values()]
    .map((list) => ({
      start: list[0]?.start ?? 0,
      duration: list[0]?.duration ?? 1,
      tones: tonesOf(list),
    }))
    .sort(
      (left, right) =>
        left.start - right.start || topPitch(right) - topPitch(left),
    );
}

function nearestVoice(
  candidates: readonly OpenEvent[][],
  group: OpenEvent,
): OpenEvent[] {
  let best = candidates[0] ?? [];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const voice of candidates) {
    const last = voice.at(-1);
    const distance =
      last === undefined ? 0 : Math.abs(topPitch(last) - topPitch(group));
    if (distance < bestDistance) {
      best = voice;
      bestDistance = distance;
    }
  }
  return best;
}

function absorb(into: OpenEvent, group: OpenEvent): void {
  const byPitch = new Map<number, number[]>();
  for (const tone of [...into.tones, ...group.tones]) {
    const ids = byPitch.get(tone.pitch);
    if (ids === undefined) {
      byPitch.set(tone.pitch, [...tone.ids]);
    } else {
      ids.push(...tone.ids);
    }
  }
  into.tones = [...byPitch.entries()]
    .sort(([left], [right]) => right - left)
    .map(([pitch, ids]) => ({ pitch, ids }));
}

/**
 * Splits a staff's quantized notes into voices, each a stream where no two
 * notes sound at once, so a note held under a moving line is written once for
 * its real length rather than restated every time the line moves.
 *
 * A note joins the first voice free by the time it starts, preferring the one
 * whose last pitch is nearest, and opens a new voice when none is free.
 */
export function separateVoices(
  notes: readonly QuantizedNote[],
): StaffEvent[][] {
  const voices: OpenEvent[][] = [[]];
  for (const group of chordGroups(notes)) {
    const free = voices.filter((voice) => endOf(voice) <= group.start);
    if (free.length > 0) {
      nearestVoice(free, group).push(group);
      continue;
    }
    if (voices.length < voicesPerStaff) {
      voices.push([group]);
      continue;
    }
    const crowded = nearestVoice(voices, group);
    const last = crowded.at(-1);
    if (last === undefined) {
      crowded.push(group);
    } else if (last.start === group.start) {
      absorb(last, group);
    } else {
      last.duration = group.start - last.start;
      crowded.push(group);
    }
  }
  return voices;
}

/** Pads a voice's notes with the silence between them, so every voice covers
 * the same span and the measures line up. */
export function fillGaps(
  events: readonly StaffEvent[],
  totalUnits: number,
): StaffEvent[] {
  const filled: StaffEvent[] = [];
  let cursor = 0;
  for (const event of events) {
    if (event.start > cursor) {
      filled.push({
        start: cursor,
        duration: event.start - cursor,
        tones: [],
      });
    }
    filled.push(event);
    cursor = event.start + event.duration;
  }
  if (cursor < totalUnits) {
    filled.push({ start: cursor, duration: totalUnits - cursor, tones: [] });
  }
  return filled;
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
  readonly voice: number;
};

/** Splits a voice's events at measure boundaries, then further at standard
 * note values within a measure, tying every chunk of one original event back
 * together whichever boundary caused the split. Every chunk keeps the tones
 * (and so the source ids) of the event it was split from, which is what lets
 * a note tied across a barline be found by identity on whichever chunk is on
 * screen. */
export function buildInstructions(
  events: readonly StaffEvent[],
  measureUnits: number,
  staff: 1 | 2,
  voice: number,
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
        voice,
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
    if (!isPrimaryVoice(instruction.voice)) {
      return (
        `<forward><duration>${instruction.durationUnits}</duration>` +
        `<voice>${instruction.voice}</voice>` +
        `<staff>${instruction.staff}</staff></forward>`
      );
    }
    return (
      "<note><rest/>" +
      `<duration>${instruction.durationUnits}</duration>` +
      `<voice>${instruction.voice}</voice><type>${type}</type>${dotXml}` +
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
        `<voice>${instruction.voice}</voice><type>${type}</type>${dotXml}` +
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
  const voices = [
    ...new Set(part.instructions.map((instruction) => instruction.voice)),
  ].sort((left, right) => left - right);
  const streams = new Map<string, NoteInstruction[]>();
  for (const instruction of part.instructions) {
    const key = `${instruction.voice}:${instruction.measureIndex}`;
    const list = streams.get(key);
    if (list === undefined) {
      streams.set(key, [instruction]);
    } else {
      list.push(instruction);
    }
  }

  const measures: string[] = [];
  for (let index = 0; index < input.measureCount; index += 1) {
    const written = voices
      .map((voice) => streams.get(`${voice}:${index}`) ?? [])
      .filter(
        (list) =>
          list.length > 0 &&
          (isPrimaryVoice(list[0]?.voice ?? 1) ||
            list.some((instruction) => instruction.tones.length > 0)),
      )
      .map((list) =>
        list
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
      `<measure number="${index + 1}">${attributes}${written.join(backup)}</measure>`,
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
