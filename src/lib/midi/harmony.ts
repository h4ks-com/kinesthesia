import { Chord } from "tonal";
import type { ChordQuality, Harmony, SongKey } from "@/lib/skins/types";

/** What is sounding over one stretch of the song, already named. Built once
 * when a song is parsed, because naming a chord costs far more than a frame
 * has, and read back by a cursor that walks forward with the playhead. */
export type HarmonySpan = {
  readonly at: number;
  readonly chord: Harmony | null;
};

const pitchClasses: readonly string[] = [
  "C",
  "Db",
  "D",
  "Eb",
  "E",
  "F",
  "Gb",
  "G",
  "Ab",
  "A",
  "Bb",
  "B",
];

/** Tonal names a chord by its type, and the type is the part that says how it
 * sounds. Everything not plainly one of these is other, since a background
 * reacting to major and minor should not be guessing about a suspended fourth. */
function qualityOf(type: string): ChordQuality {
  const name = type.toLowerCase();
  if (name.includes("diminish")) {
    return "diminished";
  }
  if (name.includes("augmented")) {
    return "augmented";
  }
  if (name.includes("minor")) {
    return "minor";
  }
  if (name.includes("major") || name === "dominant seventh") {
    return "major";
  }
  return "other";
}

export function rootOf(name: string): number {
  const index = pitchClasses.indexOf(name);
  if (index >= 0) {
    return index;
  }
  // Sharps and flats name the same key, and tonal answers with whichever the
  // chord was spelled in.
  const sharps = [
    "C",
    "C#",
    "D",
    "D#",
    "E",
    "F",
    "F#",
    "G",
    "G#",
    "A",
    "A#",
    "B",
  ];
  const found = sharps.indexOf(name);
  return found >= 0 ? found : 0;
}

export function nameChord(pitches: readonly number[]): Harmony | null {
  if (pitches.length < 2) {
    return null;
  }
  const classes = [...new Set(pitches.map((pitch) => pitch % 12))].sort(
    (left, right) => left - right,
  );
  const names = classes.map((pitch) => pitchClasses[pitch] ?? "C");
  const detected = Chord.detect(names, { assumePerfectFifth: true });
  const best = detected[0];
  if (best === undefined) {
    return null;
  }
  const parsed = Chord.get(best);
  if (parsed.empty || parsed.tonic === null) {
    return null;
  }
  return {
    name: best,
    root: rootOf(parsed.tonic),
    quality: qualityOf(parsed.type),
  };
}

/** The chord sounding at a moment, from a timeline built once. The cursor is
 * carried by the caller so playing forward costs one comparison a frame rather
 * than a search. */
export function chordAt(
  spans: readonly HarmonySpan[],
  position: number,
  from = 0,
): { chord: Harmony | null; cursor: number } {
  if (spans.length === 0) {
    return { chord: null, cursor: 0 };
  }
  let cursor = Math.min(Math.max(0, from), spans.length - 1);
  // A seek backwards is the only case that has to start over.
  if ((spans[cursor]?.at ?? 0) > position) {
    cursor = 0;
  }
  while (
    cursor + 1 < spans.length &&
    (spans[cursor + 1]?.at ?? 0) <= position
  ) {
    cursor += 1;
  }
  return { chord: spans[cursor]?.chord ?? null, cursor };
}

export type { Harmony, SongKey };
