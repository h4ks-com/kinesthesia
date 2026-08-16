import {
  beatSteps,
  buildInstructions,
  buildMusicXml,
  fillGaps,
  type Grid,
  meterGrid,
  type NoteInstruction,
  type QuantizedNote,
  quantizeNotes,
  separateVoices,
  voiceNumber,
} from "@/lib/sheet/notation";
import { keySpelling } from "@/lib/sheet/spelling";
import { clefFor, splitStaves } from "@/lib/sheet/staff-split";
import type { SheetMusic, SheetSource, WrittenNote } from "@/lib/sheet/types";

const defaultBpm = 120;

function lastUnit(notes: readonly QuantizedNote[]): number {
  return notes.reduce(
    (last, note) => Math.max(last, note.start + note.duration),
    0,
  );
}

function collectWrittenNotes(
  out: WrittenNote[],
  instructions: readonly NoteInstruction[],
  partIndex: number,
): void {
  for (const instruction of instructions) {
    for (const tone of instruction.tones) {
      out.push({
        ids: tone.ids,
        partIndex,
        measureIndex: instruction.measureIndex,
        staff: instruction.staff,
        positionInMeasure: instruction.positionInMeasure,
        pitch: tone.pitch,
      });
    }
  }
}

function staffInstructions(
  notes: readonly QuantizedNote[],
  totalUnits: number,
  grid: Grid,
  staff: 1 | 2,
): NoteInstruction[] {
  return separateVoices(notes).flatMap((events, index) =>
    buildInstructions(
      fillGaps(events, totalUnits),
      grid,
      staff,
      voiceNumber(staff, index),
    ),
  );
}

/** Quantises, splits into staves and serialises a song to MusicXML. Pure: no
 * MIDI parsing or tempo detection happens here, so it is testable with plain
 * note lists. */
export function songToSheetMusic(source: SheetSource): SheetMusic {
  const grid = meterGrid(source.meter.beats, source.meter.value);
  const bpm = source.bpm > 0 ? source.bpm : defaultBpm;

  const parts = source.parts.length === 0 ? [blankPart] : source.parts;
  const steps = beatSteps(
    parts.flatMap((part) => [...part.notes]),
    bpm,
    grid,
  );
  const quantized = parts.map((part) => {
    if (!part.split) {
      return { treble: quantizeNotes(part.notes, steps), bass: [] };
    }
    const { treble, bass } = splitStaves(part.notes);
    return {
      treble: quantizeNotes(treble, steps),
      bass: quantizeNotes(bass, steps),
    };
  });

  // The score ends when the last written note does, not whenever the audio's
  // own tail happens to run out: a single detected tempo is the grid the
  // whole converter reads time against, so the last note's own position on
  // that same grid is the only length that stays self-consistent with it.
  const rawUnits = Math.max(
    1,
    ...quantized.flatMap((one) => [lastUnit(one.treble), lastUnit(one.bass)]),
  );
  const measureCount = Math.max(1, Math.ceil(rawUnits / grid.measureUnits));
  const totalUnits = measureCount * grid.measureUnits;

  const writtenNotes: WrittenNote[] = [];
  const writtenParts = parts.map((part, partIndex) => {
    const { treble, bass } = quantized[partIndex] ?? { treble: [], bass: [] };
    if (!part.split) {
      const instructions = staffInstructions(treble, totalUnits, grid, 1);
      collectWrittenNotes(writtenNotes, instructions, partIndex);
      return { name: part.name, clefs: [clefFor(part.notes)], instructions };
    }
    const trebleInstructions = staffInstructions(treble, totalUnits, grid, 1);
    const bassInstructions = staffInstructions(bass, totalUnits, grid, 2);
    collectWrittenNotes(writtenNotes, trebleInstructions, partIndex);
    collectWrittenNotes(writtenNotes, bassInstructions, partIndex);
    return {
      name: part.name,
      clefs: ["treble", "bass"] as const,
      instructions: [...trebleInstructions, ...bassInstructions],
    };
  });

  const { table, fifths, signature } =
    source.key === null
      ? keySpelling("C", "major")
      : keySpelling(source.key.tonic, source.key.mode);

  const musicXml = buildMusicXml({
    title: source.title,
    fifths,
    grid,
    measureCount,
    parts: writtenParts,
    table,
    signature,
  });

  return {
    musicXml,
    partNames:
      source.parts.length === 0 ? [] : writtenParts.map((one) => one.name),
    writtenNotes,
  };
}

/** A song with nothing to write still needs a page, so the panel shows an empty
 * stave rather than failing to draw at all. */
const blankPart = { name: "Piano", notes: [], split: false } as const;
