import {
  detectMeter,
  detectTempo,
  estimateKey,
  readMidi,
} from "@/lib/midi/analysis";
import type { Song, Transpose } from "@/lib/midi/song";
import { readSongBytes } from "@/lib/midi/song";
import { songToSheetMusic } from "@/lib/sheet/convert";
import type { SheetMusic } from "@/lib/sheet/types";

const chromaticNames = [
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

function shiftTonic(tonic: string, semitones: number): string {
  const index = chromaticNames.indexOf(
    tonic as (typeof chromaticNames)[number],
  );
  if (index < 0) {
    return tonic;
  }
  return chromaticNames[(((index + semitones) % 12) + 12) % 12] ?? tonic;
}

/** Re-reads the file's own MIDI to get tempo, meter and key, which `Song`
 * does not carry, then hands them to the pure converter along with the
 * already transposed and runway-shifted notes the player is actually
 * sounding, so the notation and the audio agree on every pitch and time. */
export async function loadSheetMusic(
  url: string,
  song: Song,
  transpose: Transpose,
): Promise<SheetMusic> {
  const bytes = await readSongBytes(url);
  const midi = readMidi(bytes);
  const tempo = detectTempo(midi);
  const meter = detectMeter(midi);
  const keyEstimate = estimateKey(midi);

  const pitchedTracks = new Set(
    song.tracks
      .filter((track) => !track.percussion)
      .map((track) => track.index),
  );

  return songToSheetMusic({
    title: song.name,
    notes: song.notes
      .filter((note) => pitchedTracks.has(note.track))
      .map((note) => ({
        pitch: note.pitch,
        start: note.start,
        duration: note.end - note.start,
      })),
    duration: song.duration,
    bpm: tempo.bpm,
    meter: { beats: meter.beats, value: meter.value },
    key:
      keyEstimate === null
        ? null
        : {
            tonic: shiftTonic(keyEstimate.tonic, transpose),
            mode: keyEstimate.mode,
          },
  });
}
