import { Midi } from "@tonejs/midi";
import { Chord, Note } from "tonal";
import { looksTwoHanded } from "@/lib/midi/hands";

export type Meter = {
  readonly beats: number;
  readonly value: number;
  readonly explicit: boolean;
  readonly changes: number;
};

export type Tempo = {
  readonly bpm: number;
  readonly explicit: boolean;
  readonly changes: number;
};

export type Mode = "major" | "minor";

export type KeyEstimate = {
  readonly tonic: string;
  readonly mode: Mode;
  /** Correlation of the note distribution with the best-fitting key profile,
   * 0..1. Low means the music is chromatic or atonal enough that no key fits. */
  readonly correlation: number;
  /** Lead over the runner-up key. A small margin is the relative major/minor
   * ambiguity: the two share every note and only weighting tells them apart. */
  readonly margin: number;
  readonly runnerUp: string;
};

export type ChordSpan = {
  readonly bar: number;
  readonly startSeconds: number;
  /** The best chord name over the window, or null when the notes sounding form
   * no nameable chord (a chromatic cluster, a single note, silence). */
  readonly chord: string | null;
  readonly candidates: readonly string[];
};

const pitchClasses = [
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
] as const;

const defaultBpm = 120;
const defaultMeter: readonly [number, number] = [4, 4];

/** Parsing a file is cheap; reading the time off every note is not. Tick to
 * seconds walks the tempo map, and that walk degrades when many events share a
 * tick, so a small file can carry minutes of work. These bound the walk before
 * anything asks for a note time. The densest real files sit far under both. */
const maxNotes = 200_000;
const maxTempos = 5_000;

export function readMidi(bytes: ArrayBuffer | Uint8Array): Midi {
  const midi = new Midi(bytes);
  if (midi.header.tempos.length > maxTempos) {
    throw new Error("That MIDI has too many tempo changes to play.");
  }
  let notes = 0;
  for (const track of midi.tracks) {
    notes += track.notes.length;
    if (notes > maxNotes) {
      throw new Error("That MIDI has too many notes to play.");
    }
  }
  return midi;
}

export function detectTempo(midi: Midi): Tempo {
  const tempos = midi.header.tempos;
  if (tempos.length === 0) {
    return { bpm: defaultBpm, explicit: false, changes: 0 };
  }
  const end = midi.durationTicks;
  let primary = tempos[0];
  let widest = -1;
  for (let index = 0; index < tempos.length; index += 1) {
    const current = tempos[index];
    if (current === undefined) {
      continue;
    }
    const next = tempos[index + 1];
    const span = (next?.ticks ?? end) - current.ticks;
    if (span > widest) {
      widest = span;
      primary = current;
    }
  }
  return {
    bpm: Math.round(primary?.bpm ?? defaultBpm),
    explicit: true,
    changes: tempos.length,
  };
}

export function detectMeter(midi: Midi): Meter {
  const meters = midi.header.timeSignatures;
  const first = meters[0];
  if (first === undefined) {
    return {
      beats: defaultMeter[0],
      value: defaultMeter[1],
      explicit: false,
      changes: 0,
    };
  }
  return {
    beats: first.timeSignature[0] ?? defaultMeter[0],
    value: first.timeSignature[1] ?? defaultMeter[1],
    explicit: true,
    changes: meters.length,
  };
}

const majorProfile = [
  6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
];
const minorProfile = [
  6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
];

function correlate(a: readonly number[], b: readonly number[]): number {
  const n = a.length;
  let meanA = 0;
  let meanB = 0;
  for (let index = 0; index < n; index += 1) {
    meanA += a[index] ?? 0;
    meanB += b[index] ?? 0;
  }
  meanA /= n;
  meanB /= n;
  let numerator = 0;
  let varA = 0;
  let varB = 0;
  for (let index = 0; index < n; index += 1) {
    const da = (a[index] ?? 0) - meanA;
    const db = (b[index] ?? 0) - meanB;
    numerator += da * db;
    varA += da * da;
    varB += db * db;
  }
  if (varA === 0 || varB === 0) {
    return 0;
  }
  return numerator / Math.sqrt(varA * varB);
}

/** Krumhansl-Schmuckler: weight each pitch class by how long it sounds, then
 * find the key profile it best matches. Duration weighting is what makes a
 * passing chromatic note count for less than a structural one. */
/** A key is named by where it sits on the circle of fifths, which is not the
 * same as naming its tonic off a chromatic scale: the key a semitone above A is
 * B flat major, and A sharp major would need ten sharps to write down. Getting
 * this wrong reaches further than the label, because a key signature nobody can
 * notate is one the sheet music cannot be drawn from. */
const majorKeyNames = [
  "C",
  "Db",
  "D",
  "Eb",
  "E",
  "F",
  "F#",
  "G",
  "Ab",
  "A",
  "Bb",
  "B",
] as const;

const minorKeyNames = [
  "C",
  "C#",
  "D",
  "Eb",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "Bb",
  "B",
] as const;

export function keyName(pitchClass: number, mode: Mode): string {
  const names = mode === "major" ? majorKeyNames : minorKeyNames;
  return names[((pitchClass % 12) + 12) % 12] ?? "C";
}

export function estimateKey(midi: Midi): KeyEstimate | null {
  const weights = new Array<number>(12).fill(0);
  for (const track of midi.tracks) {
    if (track.instrument.percussion) {
      continue;
    }
    for (const note of track.notes) {
      const pc = note.midi % 12;
      weights[pc] = (weights[pc] ?? 0) + note.durationTicks;
    }
  }
  if (weights.every((value) => value === 0)) {
    return null;
  }
  const scored: { tonic: string; mode: Mode; r: number }[] = [];
  for (let tonic = 0; tonic < 12; tonic += 1) {
    const rotated = weights.map(
      (_, index) => weights[(index + tonic) % 12] ?? 0,
    );
    scored.push({
      tonic: keyName(tonic, "major"),
      mode: "major",
      r: correlate(rotated, majorProfile),
    });
    scored.push({
      tonic: keyName(tonic, "minor"),
      mode: "minor",
      r: correlate(rotated, minorProfile),
    });
  }
  scored.sort((left, right) => right.r - left.r);
  const best = scored[0];
  const second = scored[1];
  if (best === undefined || second === undefined) {
    return null;
  }
  return {
    tonic: best.tonic,
    mode: best.mode,
    correlation: Math.round(best.r * 100) / 100,
    margin: Math.round((best.r - second.r) * 100) / 100,
    runnerUp: `${second.tonic} ${second.mode}`,
  };
}

export type DigestTrack = {
  readonly index: number;
  readonly name: string;
  readonly instrument: string;
  readonly percussion: boolean;
  readonly notes: number;
  readonly range: readonly [string, string];
  /** Whether splitting this one into hands would give two real parts, so a
   * caller knows before offering it whether a hand of it is worth playing. */
  readonly bothHands: boolean;
};

export type HarmonySpan = {
  readonly bars: string;
  readonly chord: string;
};

/** The whole file boiled down to what an agent needs to reason about it, held
 * to a fixed size no matter how many notes the file has: one summary per track
 * and a run-length-encoded chord timeline. The same shape the song info panel,
 * midi_info and GET /api/midi/info all show, so the three can never drift. */
export type Digest = {
  readonly name: string;
  readonly durationSeconds: number;
  readonly totalNotes: number;
  readonly tempo: Tempo;
  readonly meter: Meter;
  readonly key: KeyEstimate | null;
  readonly tracks: readonly DigestTrack[];
  /** The track with the most notes, or null where the file has none. */
  readonly playedTrack: number | null;
  /** MIDI note numbers across every track, 0 where the file has no notes. */
  readonly lowestPitch: number;
  readonly highestPitch: number;
  /** Notes per second across the whole file, as a sense of how busy it is. */
  readonly density: number;
  readonly harmony: readonly HarmonySpan[];
};

function noteName(pitch: number): string {
  return Note.fromMidi(pitch);
}

/** What to call a track that names itself nothing: its instrument, or failing
 * that its position, so a track never reads as blank. */
export function trackLabel(
  trackName: string,
  instrument: string,
  position: number,
): string {
  if (trackName !== "") {
    return trackName;
  }
  if (instrument !== "") {
    return instrument;
  }
  return `Track ${position}`;
}

function harmonyRuns(spans: readonly ChordSpan[]): HarmonySpan[] {
  const runs: HarmonySpan[] = [];
  let start = -1;
  let chord: string | null = null;
  const flush = (endBar: number): void => {
    if (chord === null || start < 0) {
      return;
    }
    const first = start + 1;
    const last = endBar + 1;
    runs.push({
      bars: first === last ? `${first}` : `${first}-${last}`,
      chord,
    });
  };
  for (const span of spans) {
    if (span.chord === chord) {
      continue;
    }
    flush(span.bar - 1);
    chord = span.chord;
    start = span.bar;
  }
  flush(spans.length - 1);
  return runs;
}

/** A report for a song with nothing to say yet, so a fixture that does not
 * care about tempo, key or chords can still satisfy `Song.report`. */
export function blankDigest(name: string): Digest {
  return {
    name,
    durationSeconds: 0,
    totalNotes: 0,
    tempo: { bpm: 120, explicit: false, changes: 0 },
    meter: { beats: 4, value: 4, explicit: false, changes: 0 },
    key: null,
    tracks: [],
    playedTrack: null,
    lowestPitch: 0,
    highestPitch: 0,
    density: 0,
    harmony: [],
  };
}

function playedTrackOf(tracks: readonly DigestTrack[]): number | null {
  let best: DigestTrack | null = null;
  for (const track of tracks) {
    if (best === null || track.notes > best.notes) {
      best = track;
    }
  }
  return best?.index ?? null;
}

export function digest(midi: Midi, name: string): Digest {
  const tracks: DigestTrack[] = [];
  let totalNotes = 0;
  let lowestPitch = Infinity;
  let highestPitch = -Infinity;
  midi.tracks.forEach((track, index) => {
    if (track.notes.length === 0) {
      return;
    }
    const pitches = track.notes.map((note) => note.midi);
    const low = Math.min(...pitches);
    const high = Math.max(...pitches);
    lowestPitch = Math.min(lowestPitch, low);
    highestPitch = Math.max(highestPitch, high);
    totalNotes += track.notes.length;
    tracks.push({
      index,
      name: trackLabel(track.name, track.instrument.name, tracks.length + 1),
      instrument: track.instrument.name,
      percussion: track.instrument.percussion,
      notes: track.notes.length,
      range: [noteName(low), noteName(high)],
      bothHands: looksTwoHanded(
        track.notes.map((note, at) => ({
          id: at,
          pitch: note.midi,
          start: note.time,
          track: index,
        })),
      ),
    });
  });
  const durationSeconds = Math.round(midi.duration * 10) / 10;
  return {
    name,
    durationSeconds,
    totalNotes,
    tempo: detectTempo(midi),
    meter: detectMeter(midi),
    key: estimateKey(midi),
    tracks,
    playedTrack: playedTrackOf(tracks),
    lowestPitch: Number.isFinite(lowestPitch) ? lowestPitch : 0,
    highestPitch: Number.isFinite(highestPitch) ? highestPitch : 0,
    density:
      durationSeconds <= 0
        ? 0
        : Math.round((totalNotes / durationSeconds) * 10) / 10,
    harmony: harmonyRuns(detectChords(midi)),
  };
}

type Sounding = { pitch: number; weight: number };

export function detectChords(midi: Midi, windowBars = 1): readonly ChordSpan[] {
  const meter = detectMeter(midi);
  const barTicks = midi.header.ppq * meter.beats * (4 / meter.value);
  const windowTicks = barTicks * windowBars;
  const notes = midi.tracks
    .filter((track) => !track.instrument.percussion)
    .flatMap((track) => track.notes);
  if (notes.length === 0 || windowTicks <= 0) {
    return [];
  }
  const end = notes.reduce(
    (max, note) => Math.max(max, note.ticks + note.durationTicks),
    0,
  );
  const spans: ChordSpan[] = [];
  for (let bar = 0; bar * windowTicks < end; bar += 1) {
    const start = bar * windowTicks;
    const stop = start + windowTicks;
    const sounding = new Map<number, Sounding>();
    for (const note of notes) {
      const noteEnd = note.ticks + note.durationTicks;
      if (note.ticks >= stop || noteEnd <= start) {
        continue;
      }
      const overlap = Math.min(stop, noteEnd) - Math.max(start, note.ticks);
      const existing = sounding.get(note.midi % 12);
      const lowest = Math.min(existing?.pitch ?? note.midi, note.midi);
      sounding.set(note.midi % 12, {
        pitch: lowest,
        weight: (existing?.weight ?? 0) + overlap,
      });
    }
    spans.push({
      bar,
      startSeconds: Math.round(midi.header.ticksToSeconds(start) * 100) / 100,
      ...nameChord(sounding),
    });
  }
  return spans;
}

/** The lowest sounding pitch names the bass, so an inversion reads as a slash
 * chord; the rest follow by how long they sound. */
function nameChord(sounding: Map<number, Sounding>): {
  chord: string | null;
  candidates: readonly string[];
} {
  if (sounding.size < 2) {
    return { chord: null, candidates: [] };
  }
  const ordered = [...sounding.entries()].sort((left, right) => {
    if (left[1].pitch !== right[1].pitch) {
      return left[1].pitch - right[1].pitch;
    }
    return right[1].weight - left[1].weight;
  });
  const bass = ordered[0]?.[0] ?? 0;
  const others = ordered
    .slice(1)
    .sort((left, right) => right[1].weight - left[1].weight);
  const names = [bass, ...others.map((entry) => entry[0])].map(
    (pc) => pitchClasses[pc] ?? "C",
  );
  const detected = Chord.detect(names, { assumePerfectFifth: true });
  return { chord: detected[0] ?? null, candidates: detected.slice(0, 3) };
}
