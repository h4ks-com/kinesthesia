import type { SheetTheme } from "@/lib/sheet/types";

/** Everything the notation is drawn in, resolved from the page's custom
 * properties. Read once and carried, since a render draws frames where asking
 * a stylesheet per frame would cost a layout each time. */
export type SheetColors = {
  readonly music: string;
  readonly paper: string;
  readonly cursor: string;
  readonly cursorAlpha: number;
  /** Ink on paper takes more of the colour to read as strongly as it does on a
   * dark ground, and what to play next has to be legible as a mark in its own
   * right. */
  readonly next: string;
  readonly nextAlpha: number;
};

export function sheetColors(theme: SheetTheme): SheetColors {
  const light = theme === "light";
  return {
    music: cssVar(light ? "--ink" : "--text"),
    paper: cssVar(light ? "--paper" : "--panel"),
    cursor: cssVar(light ? "--accent-ink" : "--accent"),
    cursorAlpha: light ? 0.4 : 0.3,
    next: cssVar(light ? "--warn-ink" : "--warn"),
    nextAlpha: light ? 0.85 : 0.7,
  };
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}
