import {
  detectMeter,
  detectTempo,
  estimateKey,
  readMidi,
} from "@/lib/midi/analysis";
import { parseSong } from "@/lib/midi/song";
import { songToSheetMusic } from "@/lib/sheet/convert";
import { downloadSheetPdf } from "@/lib/sheet/export-pdf";
import { sheetParts } from "@/lib/sheet/parts";

declare global {
  interface Window {
    exportSheetPdf: (bytes: ArrayBuffer, name: string) => Promise<void>;
  }
}

/** Mirrors `loadSheetMusic`'s pipeline against bytes already in hand, since
 * this harness has no server route to fetch a MIDI from. Every note plays and
 * none are transposed: this is testing the export, not a practice slice. */
window.exportSheetPdf = async (bytes: ArrayBuffer, name: string) => {
  const song = parseSong(bytes, name);
  const midi = readMidi(bytes);
  const tempo = detectTempo(midi);
  const meter = detectMeter(midi);
  const key = estimateKey(midi);
  const sheet = songToSheetMusic({
    title: song.name,
    parts: sheetParts({
      tracks: song.tracks.map((track) => ({
        index: track.index,
        name: track.name,
        percussion: track.percussion,
      })),
      notes: song.notes.map((note) => ({
        id: note.id,
        track: note.track,
        pitch: note.pitch,
        start: note.start,
        duration: note.end - note.start,
      })),
    }),
    bpm: tempo.bpm,
    meter: { beats: meter.beats, value: meter.value },
    key: key === null ? null : { tonic: key.tonic, mode: key.mode },
  });
  await downloadSheetPdf(sheet, song.name);
};
