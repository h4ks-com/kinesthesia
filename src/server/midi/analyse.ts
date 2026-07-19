import { parseSong, type Song } from "@/lib/midi/song";
import { busiestTrack } from "@/lib/scoring/gates";
import { sourceFetch } from "@/server/http/fetch";

export type TrackSummary = {
  readonly index: number;
  readonly name: string;
  readonly instrument: string;
  readonly percussion: boolean;
  readonly notes: number;
};

export type MidiSummary = {
  readonly name: string;
  readonly duration: number;
  readonly notes: number;
  readonly tracks: readonly TrackSummary[];
  /** The track the player claims unless told otherwise. */
  readonly playedTrack: number;
  readonly lowestPitch: number;
  readonly highestPitch: number;
  /** Notes per second across the whole file, as a sense of how busy it is. */
  readonly density: number;
};

function summarise(song: Song): MidiSummary {
  const pitches = song.notes.map((note) => note.pitch);
  return {
    name: song.name,
    duration: Math.round(song.duration * 10) / 10,
    notes: song.notes.length,
    tracks: song.tracks.map((track) => ({
      index: track.index,
      name: track.name,
      instrument: track.instrument,
      percussion: track.percussion,
      notes: track.noteCount,
    })),
    playedTrack: busiestTrack(song),
    lowestPitch: pitches.length === 0 ? 0 : Math.min(...pitches),
    highestPitch: pitches.length === 0 ? 0 : Math.max(...pitches),
    density:
      song.duration <= 0
        ? 0
        : Math.round((song.notes.length / song.duration) * 10) / 10,
  };
}

/** Reads a .mid with the same parser the player runs, so what this reports is
 * what the player will show. */
export async function analyseMidi(
  url: string,
  name: string,
): Promise<MidiSummary> {
  const response = await sourceFetch(url);
  if (!response.ok) {
    throw new Error(`Could not download that MIDI (status ${response.status})`);
  }
  return summarise(parseSong(await response.arrayBuffer(), name));
}
