import {
  detectMeter,
  detectTempo,
  estimateKey,
  readMidi,
} from "@/lib/midi/analysis";
import { parseSong } from "@/lib/midi/song";
import { songToSheetMusic } from "@/lib/sheet/convert";
import { downloadSheetPdf, engravePages } from "@/lib/sheet/export-pdf";
import { sheetParts } from "@/lib/sheet/parts";
import type { SheetMusic } from "@/lib/sheet/types";

export type SheetPdfStats = {
  readonly pageCount: number;
  readonly maxSystemsOnAPage: number;
};

declare global {
  interface Window {
    exportSheetPdf: (bytes: ArrayBuffer, name: string) => Promise<void>;
    sheetPdfStats: (bytes: ArrayBuffer, name: string) => Promise<SheetPdfStats>;
  }
}

/** Mirrors `loadSheetMusic`'s pipeline against bytes already in hand, since
 * this harness has no server route to fetch a MIDI from. Every note plays and
 * none are transposed: this is testing the export, not a practice slice. */
function buildSheet(bytes: ArrayBuffer, name: string): SheetMusic {
  const song = parseSong(bytes, name);
  const midi = readMidi(bytes);
  const tempo = detectTempo(midi);
  const meter = detectMeter(midi);
  const key = estimateKey(midi);
  return songToSheetMusic({
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
}

window.exportSheetPdf = async (bytes: ArrayBuffer, name: string) => {
  const sheet = buildSheet(bytes, name);
  await downloadSheetPdf(sheet, name);
};

/** Engraves the same way `downloadSheetPdf` does, but reports how the result
 * paginated instead of downloading it: how many pages, and the most systems
 * any one of them holds, which is what tells a narrow, over-tall layout
 * (every system alone on its own page) apart from a properly dense one. */
window.sheetPdfStats = async (
  bytes: ArrayBuffer,
  name: string,
): Promise<SheetPdfStats> => {
  const sheet = buildSheet(bytes, name);
  const { host, pages } = await engravePages(sheet);
  try {
    // A system is a stave group, which OSMD draws one `g` per, so counting
    // them per page is counting how much music the page carries.
    const perPage = pages.map(
      (page) => page.querySelectorAll("g.staffline, .vf-stave").length,
    );
    return {
      pageCount: pages.length,
      maxSystemsOnAPage: Math.max(...perPage, 1),
    };
  } finally {
    host.remove();
  }
};
