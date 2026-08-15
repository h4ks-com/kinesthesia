import {
  buildInstructions,
  buildMusicXml,
  divisions,
  quantizeNotes,
  sequenceStaff,
} from "@/lib/sheet/notation";
import { keySpelling } from "@/lib/sheet/spelling";
import { splitStaves } from "@/lib/sheet/staff-split";
import type { SheetMusic, SheetSource } from "@/lib/sheet/types";

const defaultBeats = 4;
const defaultBeatType = 4;
const defaultBpm = 120;

function unitsPerMeasure(beats: number, beatType: number): number {
  const computed = Math.round((beats * divisions * 4) / beatType);
  return computed > 0 ? computed : defaultBeats * divisions;
}

/** Quantises, splits into staves and serialises a song to MusicXML. Pure: no
 * MIDI parsing or tempo detection happens here, so it is testable with plain
 * note lists. */
export function songToSheetMusic(source: SheetSource): SheetMusic {
  const beats = source.meter.beats > 0 ? source.meter.beats : defaultBeats;
  const beatType =
    source.meter.value > 0 ? source.meter.value : defaultBeatType;
  const measureUnits = unitsPerMeasure(beats, beatType);
  const bpm = source.bpm > 0 ? source.bpm : defaultBpm;
  const unitsPerSecond = (bpm / 60) * divisions;

  const rawUnits = Math.max(1, Math.round(source.duration * unitsPerSecond));
  const measureCount = Math.max(1, Math.ceil(rawUnits / measureUnits));
  const totalUnits = measureCount * measureUnits;

  const { treble, bass } = splitStaves(source.notes);
  const trebleEvents = sequenceStaff(quantizeNotes(treble, bpm), totalUnits);
  const bassEvents = sequenceStaff(quantizeNotes(bass, bpm), totalUnits);

  const { table, fifths, signature } =
    source.key === null
      ? keySpelling("C", "major")
      : keySpelling(source.key.tonic, source.key.mode);

  const musicXml = buildMusicXml({
    title: source.title,
    fifths,
    beats,
    beatType,
    measureCount,
    measureUnits,
    treble: buildInstructions(trebleEvents, measureUnits, 1),
    bass: buildInstructions(bassEvents, measureUnits, 2),
    table,
    signature,
  });

  const cursorOnsets = [
    ...new Set([...trebleEvents, ...bassEvents].map((event) => event.start)),
  ]
    .sort((left, right) => left - right)
    .map((units) => units / unitsPerSecond);

  return { musicXml, cursorOnsets };
}
