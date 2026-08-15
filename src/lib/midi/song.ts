import type { Midi } from "@tonejs/midi";
import {
  type Digest,
  digest,
  estimateKey,
  readMidi,
  trackLabel,
} from "@/lib/midi/analysis";
import { ExpressionTrail } from "@/lib/midi/expression";
import { assignHandsForSong, type HandMap } from "@/lib/midi/hands";
import { type HarmonySpan, nameChord, rootOf } from "@/lib/midi/harmony";
import { pedalSpans, releaseAt } from "@/lib/midi/sustain";
import type { SongKey } from "@/lib/skins/types";
import { readUpload } from "@/lib/storage/uploads";
import { isDeviceLocal } from "@/lib/trusted-url";

export const noteNames = [
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

export const lowestPitch = 21;
export const highestPitch = 108;

/** Seconds of runway before the first note when a song would otherwise open on
 * the strike line. */
const startLeadIn = 2.5;

/** Seconds the song runs on past its last sound. A file ends on the note-off,
 * so stopping there cuts the release mid-ring and drops the roll on the beat;
 * this lets it land. */
const endTail = 2.5;

/** A real MIDI is kilobytes; this only stops a hostile or mistaken file from
 * exhausting the tab's memory as it parses. */
export const maxMidiBytes = 5 * 1024 * 1024;

/** One wheel event before the song's runway shift is known. A wheel belongs to
 * a channel, which is not always the track holding that channel's notes. */
type WheelMove = { readonly channel: number; readonly at: number } & (
  | { readonly bend: number; readonly depth?: undefined }
  | { readonly depth: number; readonly bend?: undefined }
);

function decodeMidi(data: ArrayBuffer): Midi {
  if (data.byteLength > maxMidiBytes) {
    throw new Error("That MIDI file is too large to play.");
  }
  try {
    return readMidi(data);
  } catch (error) {
    // The reader's own limits name what is wrong, so they reach the player
    // rather than being flattened into "not a valid MIDI".
    throw error instanceof Error && error.message.startsWith("That MIDI")
      ? error
      : new Error("That file is not a valid MIDI.");
  }
}

/** `end` is when the key came up, the length the roll draws. `release` is when
 * the sound stops, which the pedal can carry past `end`. */
export type SongNote = {
  readonly id: number;
  readonly pitch: number;
  readonly start: number;
  readonly end: number;
  readonly release: number;
  readonly velocity: number;
  readonly track: number;
};

export type SongTrack = {
  readonly index: number;
  readonly name: string;
  readonly instrument: string;
  readonly program: number;
  readonly percussion: boolean;
  readonly noteCount: number;
};

/** A note as play mode emits it live, rising out of the keys. Both times are
 * null while the note is still open. */
export type LiveNote = {
  readonly id: number;
  readonly pitch: number;
  readonly track: number;
  readonly velocity: number;
  readonly start: number;
  end: number | null;
  release: number | null;
};

export type Song = {
  readonly name: string;
  readonly duration: number;
  readonly notes: readonly SongNote[];
  readonly tracks: readonly SongTrack[];
  /** The bend and modulation the file writes, per track. */
  readonly expression: ExpressionTrail;
  /** What is sounding across the song, named once here because naming a chord
   * costs more than a frame has. A background reads it through `chordAt`. */
  readonly harmony: readonly HarmonySpan[];
  /** The key the whole song sits in, where one fits well enough to say. */
  readonly key: SongKey | null;
  /** Tempo, meter, per-track detail and the chord progression, computed once
   * here so the song info panel reads it straight off the parsed song instead
   * of asking the server again for what this tab already worked out. */
  readonly report: Digest;
  /** Which hand plays each note, worked out once per track here because both
   * sides of a match need to land on the identical split. */
  readonly hands: HandMap;
};

/** How often the harmony is named. Short enough to catch a chord change, long
 * enough that a run of passing notes does not rename it every beat. */
const harmonyWindow = 0.5;

function harmonyOf(
  notes: readonly SongNote[],
  duration: number,
): HarmonySpan[] {
  const spans: HarmonySpan[] = [];
  // Nothing a chord can be named, so the opening silence is a span of its own
  // rather than the first thing skipped. A timeline that starts at the first
  // chord is read as that chord holding from zero, and every song opens on a
  // runway with nothing sounding on it.
  let last: string | null = null;
  let from = 0;
  for (let at = 0; at < duration; at += harmonyWindow) {
    const until = at + harmonyWindow;
    const sounding: number[] = [];
    // The notes are sorted by start, so the scan only has to move forward.
    while (from < notes.length && (notes[from]?.end ?? 0) < at) {
      from += 1;
    }
    for (let i = from; i < notes.length; i += 1) {
      const note = notes[i];
      if (note === undefined || note.start >= until) {
        break;
      }
      if (note.end > at) {
        sounding.push(note.pitch);
      }
    }
    const chord = nameChord(sounding);
    const name = chord?.name ?? "";
    // Only where it changed: a background asking what is sounding wants the
    // chord, not one entry per window of the same one.
    if (name !== last) {
      spans.push({ at, chord });
      last = name;
    }
  }
  return spans;
}

export function isBlackKey(pitch: number): boolean {
  const offset = pitch % 12;
  return (
    offset === 1 ||
    offset === 3 ||
    offset === 6 ||
    offset === 8 ||
    offset === 10
  );
}

export function noteName(pitch: number): string {
  return noteNames[pitch % 12] ?? "C";
}

export function parseSong(data: ArrayBuffer, name: string): Song {
  const midi = decodeMidi(data);
  const notes: SongNote[] = [];
  const tracks: SongTrack[] = [];
  const wheels: WheelMove[] = [];

  for (const [index, track] of midi.tracks.entries()) {
    for (const bend of track.pitchBends) {
      wheels.push({ channel: track.channel, at: bend.time, bend: bend.value });
    }
    for (const wheel of track.controlChanges[1] ?? []) {
      wheels.push({
        channel: track.channel,
        at: wheel.time,
        depth: wheel.value,
      });
    }
    if (track.notes.length === 0) {
      continue;
    }
    tracks.push({
      index,
      name: trackLabel(track.name, track.instrument.name, tracks.length + 1),
      instrument: track.instrument.name,
      program: track.instrument.number,
      percussion: track.instrument.percussion,
      noteCount: track.notes.length,
    });
    const trackEnd = track.notes.reduce(
      (last, note) => Math.max(last, note.time + note.duration),
      0,
    );
    const spans = pedalSpans(track.controlChanges[64] ?? [], trackEnd);
    for (const note of track.notes) {
      const end = note.time + note.duration;
      notes.push({
        id: notes.length,
        pitch: note.midi,
        start: note.time,
        end,
        release: releaseAt(end, spans),
        velocity: note.velocity,
        track: index,
      });
    }
  }

  if (tracks.length === 0) {
    throw new Error("That MIDI has no playable notes.");
  }

  notes.sort((left, right) => left.start - right.start);

  // A song whose first note sits at zero would open with it already on the
  // strike line, so everything is nudged forward to give the notes a runway to
  // fall in. A song that already opens with a gap is left alone.
  const firstStart = notes[0]?.start ?? startLeadIn;
  const shift = firstStart < startLeadIn ? startLeadIn - firstStart : 0;
  const runwayNotes =
    shift === 0
      ? notes
      : notes.map((note) => ({
          ...note,
          start: note.start + shift,
          end: note.end + shift,
          release: note.release + shift,
        }));

  // Pushed in time order: the trail treats a backwards stamp as a restart and
  // drops what it has.
  const expression = new ExpressionTrail({ keepAll: true });
  const playedBy = new Map<number, number[]>();
  for (const [index, track] of midi.tracks.entries()) {
    if (track.notes.length > 0) {
      playedBy.set(track.channel, [
        ...(playedBy.get(track.channel) ?? []),
        index,
      ]);
    }
  }
  wheels.sort((left, right) => left.at - right.at);
  for (const move of wheels) {
    for (const track of playedBy.get(move.channel) ?? []) {
      if (move.bend !== undefined) {
        expression.setBend(track, move.at + shift, move.bend);
      } else if (move.depth !== undefined) {
        expression.setDepth(track, move.at + shift, move.depth);
      }
    }
  }

  // Off the last release rather than the file's end: a song finishing under the
  // pedal sounds past its final note-off.
  const lastSound = runwayNotes.reduce(
    (last, note) => Math.max(last, note.release),
    midi.duration + shift,
  );

  const key = estimateKey(midi);
  return {
    name,
    duration: lastSound + endTail,
    harmony: harmonyOf(runwayNotes, lastSound + endTail),
    key: key === null ? null : { root: rootOf(key.tonic), mode: key.mode },
    notes: runwayNotes,
    tracks,
    expression,
    report: digest(midi, name),
    hands: assignHandsForSong(runwayNotes),
  };
}

export const transposes = [
  -12, -11, -10, -9, -8, -7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8,
  9, 10, 11, 12,
] as const;

export type Transpose = (typeof transposes)[number];

export const transposeRange = { min: -12, max: 12 } as const;
export const defaultTranspose: Transpose = 0;

export function clampTranspose(value: number): Transpose {
  if (!Number.isFinite(value)) {
    return defaultTranspose;
  }
  const whole = Math.round(value);
  return (
    transposes.find((step) => step === whole) ??
    (whole < transposeRange.min ? transposeRange.min : transposeRange.max)
  );
}

export function formatTranspose(semitones: Transpose): string {
  return semitones > 0 ? `+${semitones}` : String(semitones);
}

/** The shift a song can actually take, given it has to land on the keyboard.
 * The whole song moves as one: folding a single note that ran off the end
 * would drop it an octave below its neighbours and rewrite the tune. Octaves
 * are given back first, which keeps the key that was asked for, and a song
 * already filling the keyboard simply moves as far as it can. */
function fitShift(low: number, high: number, semitones: number): number {
  let shift = semitones;
  while (high + shift > highestPitch && low + shift - 12 >= lowestPitch) {
    shift -= 12;
  }
  while (low + shift < lowestPitch && high + shift + 12 <= highestPitch) {
    shift += 12;
  }
  if (high + shift > highestPitch) {
    shift = highestPitch - high;
  }
  if (low + shift < lowestPitch) {
    shift = lowestPitch - low;
  }
  return shift;
}

/** Moves the song to another key. A drum kit maps note numbers to instruments
 * rather than pitches, so percussion is left where it is. */
export function transposeSong(song: Song, semitones: Transpose): Song {
  if (semitones === 0) {
    return song;
  }
  const pitched = new Set(
    song.tracks
      .filter((track) => !track.percussion)
      .map((track) => track.index),
  );
  const line = song.notes
    .filter((note) => pitched.has(note.track))
    .map((note) => note.pitch);
  if (line.length === 0) {
    return song;
  }
  const shift = fitShift(Math.min(...line), Math.max(...line), semitones);
  if (shift === 0) {
    return song;
  }
  return {
    ...song,
    notes: song.notes.map((note) =>
      pitched.has(note.track) ? { ...note, pitch: note.pitch + shift } : note,
    ),
  };
}

/** The single place that resolves a device-local address to the browser's own
 * store, so playing a song and handing the file over agree on where it lives. */
export async function readSongBytes(url: string): Promise<ArrayBuffer> {
  if (isDeviceLocal(url)) {
    return readUpload(url);
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not download that MIDI (status ${response.status})`);
  }
  const declaredBytes = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredBytes) && declaredBytes > maxMidiBytes) {
    throw new Error("That MIDI file is too large to play.");
  }
  return response.arrayBuffer();
}

export async function loadSong(url: string, name: string): Promise<Song> {
  return parseSong(await readSongBytes(url), name);
}
