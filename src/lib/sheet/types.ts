import type { Mode } from "@/lib/midi/analysis";

export type SheetNote = {
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
  readonly duration: number;
  readonly bpm: number;
  readonly meter: SheetMeter;
  readonly key: SheetKey | null;
};

export type SheetMusic = {
  readonly musicXml: string;
  /** What each written line is played by, in the order they are written. */
  readonly partNames: readonly string[];
  /** Seconds at which the OSMD cursor should step forward: one entry per
   * distinct onset across both staves, ascending, including rests. */
  readonly cursorOnsets: readonly number[];
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
