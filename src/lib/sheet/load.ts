import {
  detectMeter,
  detectTempo,
  estimateKey,
  readMidi,
} from "@/lib/midi/analysis";
import type { Song, Transpose } from "@/lib/midi/song";
import { readSongBytes } from "@/lib/midi/song";
import { songToSheetMusic } from "@/lib/sheet/convert";
import { sheetParts } from "@/lib/sheet/parts";
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
  /** Which notes the page is for: the part you owe when you are learning it,
   * and whatever is still audible when you are watching. The player already
   * knows both, so the notation is written from what it hands over rather than
   * working the same question out a second way. */
  noteIds: ReadonlySet<number>,
): Promise<SheetMusic> {
  const bytes = await readSongBytes(url);
  const midi = readMidi(bytes);
  const tempo = detectTempo(midi);
  const meter = detectMeter(midi);
  const keyEstimate = estimateKey(midi);

  const chosen = song.notes.filter((note) => noteIds.has(note.id));

  return songToSheetMusic({
    title: song.name,
    parts: sheetParts({
      tracks: song.tracks.map((track) => ({
        index: track.index,
        name: track.name,
        percussion: track.percussion,
      })),
      notes: chosen.map((note) => ({
        track: note.track,
        pitch: note.pitch,
        start: note.start,
        duration: note.end - note.start,
      })),
    }),
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
