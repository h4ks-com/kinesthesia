import {
  buildInstructions,
  buildMusicXml,
  divisions,
  quantizeNotes,
  type StaffEvent,
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

  return {
    musicXml,
    cursorOnsets: onsetSeconds(
      [...trebleEvents, ...bassEvents],
      unitsPerSecond,
    ),
  };
}

/** When each written moment is heard. The grid is one tempo because that is
 * what reads well, so it is never the clock: each note anchors its own moment
 * and a rest is placed proportionally between its neighbours. */
function onsetSeconds(
  events: readonly StaffEvent[],
  unitsPerSecond: number,
): number[] {
  const anchors = new Map<number, number>();
  for (const event of events) {
    if (event.at !== null) {
      anchors.set(
        event.start,
        Math.min(anchors.get(event.start) ?? event.at, event.at),
      );
    }
  }
  const anchored = [...anchors].sort(([left], [right]) => left - right);
  const units = [...new Set(events.map((event) => event.start))].sort(
    (left, right) => left - right,
  );

  const onsets: number[] = [];
  let reached = 0;
  for (const unit of units) {
    const known = anchors.get(unit);
    if (known !== undefined) {
      onsets.push(known);
      continue;
    }
    while (
      reached < anchored.length &&
      (anchored[reached]?.[0] ?? Number.POSITIVE_INFINITY) < unit
    ) {
      reached += 1;
    }
    const before = anchored[reached - 1];
    const after = anchored[reached];
    if (before === undefined) {
      onsets.push(
        after === undefined
          ? unit / unitsPerSecond
          : Math.max(0, after[1] - (after[0] - unit) / unitsPerSecond),
      );
      continue;
    }
    if (after === undefined) {
      onsets.push(before[1] + (unit - before[0]) / unitsPerSecond);
      continue;
    }
    const share = (unit - before[0]) / (after[0] - before[0]);
    onsets.push(before[1] + share * (after[1] - before[1]));
  }
  return onsets;
}
