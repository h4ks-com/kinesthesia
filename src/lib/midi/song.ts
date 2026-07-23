import { Midi } from "@tonejs/midi";
import { isLocalUrl, readUpload } from "@/lib/storage/uploads";

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

/** A real MIDI is kilobytes; this only stops a hostile or mistaken file from
 * exhausting the tab's memory as it parses. */
export const maxMidiBytes = 5 * 1024 * 1024;

function decodeMidi(data: ArrayBuffer): Midi {
  if (data.byteLength > maxMidiBytes) {
    throw new Error("That MIDI file is too large to play.");
  }
  try {
    return new Midi(data);
  } catch {
    throw new Error("That file is not a valid MIDI.");
  }
}

export type SongNote = {
  readonly id: number;
  readonly pitch: number;
  readonly start: number;
  readonly end: number;
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

/** A note as play mode emits it live: struck at `start`, still sounding while
 * `end` is null, then released. Drawn rising out of the keys rather than
 * falling onto them. */
export type LiveNote = {
  readonly id: number;
  readonly pitch: number;
  readonly track: number;
  readonly velocity: number;
  readonly start: number;
  end: number | null;
};

export type Song = {
  readonly name: string;
  readonly duration: number;
  readonly notes: readonly SongNote[];
  readonly tracks: readonly SongTrack[];
};

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

function trackLabel(
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

export function parseSong(data: ArrayBuffer, name: string): Song {
  const midi = decodeMidi(data);
  const notes: SongNote[] = [];
  const tracks: SongTrack[] = [];

  for (const [index, track] of midi.tracks.entries()) {
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
    for (const note of track.notes) {
      notes.push({
        id: notes.length,
        pitch: note.midi,
        start: note.time,
        end: note.time + note.duration,
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
        }));

  return {
    name,
    duration: midi.duration + shift,
    notes: runwayNotes,
    tracks,
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

export async function loadSong(url: string, name: string): Promise<Song> {
  if (isLocalUrl(url)) {
    return parseSong(await readUpload(url), name);
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not download that MIDI (status ${response.status})`);
  }
  const declaredBytes = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredBytes) && declaredBytes > maxMidiBytes) {
    throw new Error("That MIDI file is too large to play.");
  }
  return parseSong(await response.arrayBuffer(), name);
}
