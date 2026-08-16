import type { Mode } from "@/lib/midi/analysis";

export type SheetNote = {
  /** The source note this came from, carried through quantisation, the
   * staff split and tie splitting so a written note can be found again by
   * what it sounds for rather than by when the engraver happened to stop. */
  readonly id: number;
  readonly pitch: number;
  readonly start: number;
  readonly duration: number;
};

export type SheetKey = {
  readonly tonic: string;
  readonly mode: Mode;
};

export type SheetMeter = {
  readonly beats: number;
  readonly value: number;
};

/** One line of the score. An instrument in an ensemble is read as one line;
 * a piano alone is read across a grand staff, which is the same question as
 * which hand plays each note, so only that case is split. */
export type SheetPart = {
  readonly name: string;
  readonly notes: readonly SheetNote[];
  readonly split: boolean;
};

/** Everything the converter needs, decoupled from `Song` and from `Midi` so it
 * stays testable with plain note lists. */
export type SheetSource = {
  readonly title: string;
  readonly parts: readonly SheetPart[];
  readonly bpm: number;
  readonly meter: SheetMeter;
  readonly key: SheetKey | null;
};

/** Where one written note lives on the page, and which source notes it
 * sounds for. A tied note keeps the same ids across every chunk the barline
 * or a long duration split it into, which is what lets a still-sounding note
 * be found on whichever chunk is on screen. Coordinates are the converter's
 * own: `partIndex` into `partNames`, `staff` 1 or 2, and `positionInMeasure`
 * in 16th-note units, so a page that has actually rendered this MusicXML can
 * find the same note again in its own graphical model. */
export type WrittenNote = {
  readonly ids: readonly number[];
  readonly partIndex: number;
  readonly measureIndex: number;
  readonly staff: 1 | 2;
  readonly positionInMeasure: number;
  readonly pitch: number;
};

export type SheetMusic = {
  readonly musicXml: string;
  /** What each written line is played by, in the order they are written. */
  readonly partNames: readonly string[];
  readonly writtenNotes: readonly WrittenNote[];
};

/** How much of the screen the notation takes: none, half alongside the
 * falling notes, or the whole view. A global setting, not a per song one, so
 * whatever a listener picks stays picked for the next song too. */
export type NotationView = "off" | "half" | "full";

export function clampNotationView(value: unknown): NotationView {
  return value === "half" || value === "full" ? value : "off";
}

/** Ink on the panel's own dark background, or dark ink on a light paper
 * background, the way printed notation reads. A global setting, like the
 * notation view itself. */
export type SheetTheme = "dark" | "light";

export function clampSheetTheme(value: unknown): SheetTheme {
  return value === "light" ? "light" : "dark";
}
