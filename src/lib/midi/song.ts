import { Midi } from "@tonejs/midi";

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
  const midi = new Midi(data);
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

  notes.sort((left, right) => left.start - right.start);

  return {
    name,
    duration: midi.duration,
    notes,
    tracks,
  };
}

export async function loadSong(url: string, name: string): Promise<Song> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not download that MIDI (status ${response.status})`);
  }
  return parseSong(await response.arrayBuffer(), name);
}
