import type { Spelling, Step } from "@/lib/sheet/spelling";
import { spellPitch } from "@/lib/sheet/spelling";
import type { SheetNote } from "@/lib/sheet/types";

/** Divisions per quarter note in the produced MusicXML: the smallest number
 * that writes every value an engraver reaches for exactly, since it divides by
 * both four and three. A 32nd is 3 units, a dotted 16th is 9, and an
 * eighth-note triplet is 8. */
export const divisions = 24;

const unitsPerWhole = divisions * 4;

const defaultBeats = 4;
const defaultBeatType = 4;

/** The meter, and the measure and beat it is read in, in `divisions` units.
 * Quantising, duration splitting and beaming all group music against this one
 * description, so they cannot disagree about where a beat falls. */
export type Grid = {
  readonly beats: number;
  readonly beatType: number;
  readonly measureUnits: number;
  readonly beatUnits: number;
  /** How many equal parts of a beat an onset may be snapped onto, coarsest
   * first. A compound beat divides by three before it divides by two. */
  readonly beatParts: readonly number[];
};

const simpleBeatParts = [1, 2, 4, 8] as const;
const compoundBeatParts = [1, 3, 6, 12] as const;

/** 6/8, 9/8 and 12/8 are felt in dotted beats, so one beat there is three of
 * the written value rather than one. */
function isCompound(beats: number, beatType: number): boolean {
  return beatType >= 8 && beats >= 6 && beats % 3 === 0;
}

export function meterGrid(beats: number, beatType: number): Grid {
  const safeBeats = beats > 0 ? beats : defaultBeats;
  const safeBeatType = beatType > 0 ? beatType : defaultBeatType;
  const written = Math.max(3, Math.round(unitsPerWhole / safeBeatType));
  const compound = isCompound(safeBeats, safeBeatType);
  const beatUnits = compound ? written * 3 : written;
  return {
    beats: safeBeats,
    beatType: safeBeatType,
    measureUnits: safeBeats * written,
    beatUnits,
    beatParts: (compound ? compoundBeatParts : simpleBeatParts).filter(
      (count) => beatUnits % count === 0,
    ),
  };
}

export type QuantizedNote = {
  readonly id: number;
  readonly pitch: number;
  readonly start: number;
  readonly duration: number;
};

/** The subdivision each beat of the score is written on. Read once from every
 * note the score will carry, because two hands and two instruments striking
 * one beat have to land on the same ruler or the page shows them apart. */
export type BeatSteps = {
  readonly unitsPerSecond: number;
  readonly beatUnits: number;
  readonly byBeat: ReadonlyMap<number, number>;
};

/** Snapping every onset onto the finest grid available writes rhythms nobody
 * can read, so each beat takes the coarsest subdivision that still explains the
 * onsets landing in it: a subdivision costs how far it moves those onsets plus
 * its own part count, both in grid units. That count is what keeps a chord's
 * spread attacks on one stem and still lets a beat of real 32nds be written as
 * 32nds. Tempo changes are not modelled: `bpm` is the single detected tempo,
 * matching what the rest of the converter treats as constant. */
export function beatSteps(
  notes: readonly SheetNote[],
  bpm: number,
  grid: Grid,
): BeatSteps {
  const unitsPerSecond = (bpm / 60) * divisions;
  const offsets = new Map<number, number[]>();
  for (const note of notes) {
    const start = note.start * unitsPerSecond;
    const beat = Math.floor(start / grid.beatUnits);
    const offset = start - beat * grid.beatUnits;
    const list = offsets.get(beat);
    if (list === undefined) {
      offsets.set(beat, [offset]);
    } else {
      list.push(offset);
    }
  }
  const byBeat = new Map<number, number>();
  for (const [beat, within] of offsets) {
    let best = grid.beatUnits;
    let bestCost = Number.POSITIVE_INFINITY;
    for (const count of grid.beatParts) {
      const step = grid.beatUnits / count;
      let cost = count;
      for (const offset of within) {
        cost += Math.abs(offset - Math.round(offset / step) * step);
      }
      if (cost < bestCost) {
        bestCost = cost;
        best = step;
      }
    }
    byBeat.set(beat, best);
  }
  return { unitsPerSecond, beatUnits: grid.beatUnits, byBeat };
}

/** Snaps note starts and releases onto their beat's chosen subdivision. */
export function quantizeNotes(
  notes: readonly SheetNote[],
  steps: BeatSteps,
): QuantizedNote[] {
  const stepAt = (units: number): number =>
    steps.byBeat.get(Math.floor(units / steps.beatUnits)) ?? steps.beatUnits;
  const snap = (units: number): number => {
    const step = stepAt(units);
    return Math.round(units / step) * step;
  };
  return notes.map((note) => {
    const raw = note.start * steps.unitsPerSecond;
    const start = snap(raw);
    const end = snap((note.start + note.duration) * steps.unitsPerSecond);
    return {
      id: note.id,
      pitch: note.pitch,
      start,
      duration: Math.max(end - start, stepAt(raw)),
    };
  });
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

const noteTypeNames = [
  "whole",
  "half",
  "quarter",
  "eighth",
  "16th",
  "32nd",
] as const;

type NoteTypeName = (typeof noteTypeNames)[number];

type WrittenValue = {
  readonly units: number;
  readonly type: NoteTypeName;
  readonly dots: number;
};

/** Every length one notehead can carry, longest first. Derived from
 * `divisions` so the two cannot drift apart. */
const writtenValues: readonly WrittenValue[] = noteTypeNames
  .flatMap((type, index) => {
    const plain = unitsPerWhole / 2 ** index;
    return [
      { units: plain * 1.5, type, dots: 1 },
      { units: plain, type, dots: 0 },
    ];
  })
  .filter((one) => Number.isInteger(one.units) && one.units <= unitsPerWhole)
  .sort((left, right) => right.units - left.units);

const valueByUnits = new Map(writtenValues.map((one) => [one.units, one]));

/** Breaks a duration into written values, reading the beat before the note:
 * one that fills a beat is written once, one that starts inside a beat stops
 * at the end of it, and one that starts on a beat may only run over further
 * beats whole. Nothing is tied across a boundary it did not have to cross. */
export function decomposeDuration(
  offsetInMeasure: number,
  units: number,
  grid: Grid,
): number[] {
  const chunks: number[] = [];
  let pos = offsetInMeasure;
  let remaining = units;
  while (remaining > 0) {
    const intoBeat = pos % grid.beatUnits;
    const room =
      intoBeat === 0
        ? remaining
        : Math.min(remaining, grid.beatUnits - intoBeat);
    const value =
      writtenValues.find(
        (one) =>
          one.units <= room &&
          (one.units <= grid.beatUnits ||
            (intoBeat === 0 && one.units % grid.beatUnits === 0)),
      )?.units ?? room;
    chunks.push(value);
    pos += value;
    remaining -= value;
  }
  return chunks;
}

export type BeamKind =
  | "begin"
  | "continue"
  | "end"
  | "forward hook"
  | "backward hook";

export type Beam = {
  readonly number: number;
  readonly kind: BeamKind;
};

/** Beam lines a value carries: one for an eighth, one more for each halving
 * below it. A dot lengthens a note without adding a line. */
function beamCount(units: number): number {
  const value = valueByUnits.get(units);
  if (value === undefined) {
    return 0;
  }
  const depth = noteTypeNames.indexOf(value.type);
  return Math.max(0, depth - noteTypeNames.indexOf("quarter"));
}

/** Every beam line of one group, level by level. A line spanning a single note
 * is a hook, angled back into the group it hangs off, which is how a dotted
 * eighth and its sixteenth beam together at all. */
function beamKinds(counts: readonly number[]): Beam[][] {
  const kinds: Beam[][] = counts.map(() => []);
  const deepest = Math.max(...counts);
  for (let level = 1; level <= deepest; level += 1) {
    let index = 0;
    while (index < counts.length) {
      if ((counts[index] ?? 0) < level) {
        index += 1;
        continue;
      }
      let last = index;
      while (last + 1 < counts.length && (counts[last + 1] ?? 0) >= level) {
        last += 1;
      }
      if (last === index) {
        kinds[index]?.push({
          number: level,
          kind: index === 0 ? "forward hook" : "backward hook",
        });
      } else {
        kinds[index]?.push({ number: level, kind: "begin" });
        for (let middle = index + 1; middle < last; middle += 1) {
          kinds[middle]?.push({ number: level, kind: "continue" });
        }
        kinds[last]?.push({ number: level, kind: "end" });
      }
      index = last + 1;
    }
  }
  return kinds;
}

type Draft = {
  measureIndex: number;
  positionInMeasure: number;
  tones: readonly ChordTone[];
  durationUnits: number;
  tieStart: boolean;
  tieStop: boolean;
};

/** Groups a voice's beamable noteheads by the beat they fall in, so a run of
 * sixteenths reads as one group. A rest, a note a quarter or longer, and the
 * end of a beat each close the group open at the time. */
function beamsFor(drafts: readonly Draft[], grid: Grid): Beam[][] {
  const beams: Beam[][] = drafts.map(() => []);
  let run: number[] = [];
  const flush = (): void => {
    if (run.length > 1) {
      const kinds = beamKinds(
        run.map((at) => beamCount(drafts[at]?.durationUnits ?? 0)),
      );
      run.forEach((at, position) => {
        beams[at] = kinds[position] ?? [];
      });
    }
    run = [];
  };

  drafts.forEach((draft, index) => {
    if (draft.tones.length === 0 || beamCount(draft.durationUnits) === 0) {
      flush();
      return;
    }
    const open = drafts[run.at(-1) ?? -1];
    const beat = Math.floor(draft.positionInMeasure / grid.beatUnits);
    if (
      open !== undefined &&
      (open.measureIndex !== draft.measureIndex ||
        Math.floor(open.positionInMeasure / grid.beatUnits) !== beat)
    ) {
      flush();
    }
    run.push(index);
  });
  flush();
  return beams;
}

export type NoteInstruction = {
  readonly measureIndex: number;
  /** Offset within the measure, in the same `divisions` units as the grid. */
  readonly positionInMeasure: number;
  readonly tones: readonly ChordTone[];
  readonly durationUnits: number;
  /** Sound continues into a later chunk of the same original event. */
  readonly tieStart: boolean;
  /** Continues a tie from an earlier chunk of the same original event. */
  readonly tieStop: boolean;
  readonly staff: 1 | 2;
  readonly voice: number;
  readonly beams: readonly Beam[];
};

/** Splits a voice's events at measure boundaries, then at beats and written
 * values within a measure, tying every chunk of one original event back
 * together whichever boundary caused the split. Every chunk keeps the tones
 * (and so the source ids) of the event it was split from, which is what lets
 * a note tied across a barline be found by identity on whichever chunk is on
 * screen. */
export function buildInstructions(
  events: readonly StaffEvent[],
  grid: Grid,
  staff: 1 | 2,
  voice: number,
): NoteInstruction[] {
  const drafts: Draft[] = [];
  for (const event of events) {
    const first = drafts.length;
    const isRest = event.tones.length === 0;
    let pos = event.start;
    let remaining = event.duration;
    while (remaining > 0) {
      const measureIndex = Math.floor(pos / grid.measureUnits);
      const offset = pos - measureIndex * grid.measureUnits;
      const room = Math.min(remaining, grid.measureUnits - offset);
      // Silence has no stem to read the beat off, so a rest is written beat by
      // beat unless it takes the whole measure, where one rest is the reading.
      const span =
        isRest && !(offset === 0 && room === grid.measureUnits)
          ? Math.min(room, grid.beatUnits - (offset % grid.beatUnits))
          : room;
      let within = offset;
      for (const value of decomposeDuration(offset, span, grid)) {
        drafts.push({
          measureIndex,
          positionInMeasure: within,
          tones: event.tones,
          durationUnits: value,
          tieStart: false,
          tieStop: false,
        });
        within += value;
      }
      pos += span;
      remaining -= span;
    }
    if (!isRest) {
      for (let index = first; index < drafts.length; index += 1) {
        const draft = drafts[index];
        if (draft !== undefined) {
          draft.tieStart = index < drafts.length - 1;
          draft.tieStop = index > first;
        }
      }
    }
  }
  const beams = beamsFor(drafts, grid);
  return drafts.map((draft, index) => ({
    ...draft,
    staff,
    voice,
    beams: beams[index] ?? [],
  }));
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
  const { type, dots } = valueByUnits.get(instruction.durationUnits) ?? {
    type: "quarter",
    dots: 0,
  };
  const dotXml = "<dot/>".repeat(dots);
  const beamXml = instruction.beams
    .map((beam) => `<beam number="${beam.number}">${beam.kind}</beam>`)
    .join("");
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
      // MusicXML hangs a chord's beams off its first note alone, and orders a
      // note's children: type, dot, accidental, staff, beam, notations.
      return (
        `<note>${chordXml}<pitch><step>${spelled.step}</step>${alterXml}` +
        `<octave>${spelled.octave}</octave></pitch>` +
        `<duration>${instruction.durationUnits}</duration>${tieXml}` +
        `<voice>${instruction.voice}</voice><type>${type}</type>${dotXml}` +
        `${accidentalXml}<staff>${instruction.staff}</staff>` +
        `${index === 0 ? beamXml : ""}${notationsXml}</note>`
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
  grid: Grid,
  clefs: readonly StaffClef[],
): string {
  return (
    `<attributes><divisions>${divisions}</divisions>` +
    `<key><fifths>${fifths}</fifths></key>` +
    `<time><beats>${grid.beats}</beats>` +
    `<beat-type>${grid.beatType}</beat-type></time>` +
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
  readonly grid: Grid;
  readonly measureCount: number;
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
      index === 0 ? attributesXml(input.fifths, input.grid, part.clefs) : "";
    const backup = `<backup><duration>${input.grid.measureUnits}</duration></backup>`;
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
