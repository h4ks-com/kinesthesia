export type NoteColor = {
  /** The deep end of the hue, carrying the trailing edge of a note so the bar
   * has tonal range rather than reading as one flat colour. */
  readonly shade: string;
  readonly glow: string;
  readonly core: string;
  /** One muted tone for the plain style, which fills a note flat instead of
   * ramping it. */
  readonly flat: string;
};

const trackColors: readonly NoteColor[] = [
  { shade: "#1f8f6d", glow: "#35d6a4", core: "#8ff0d0", flat: "#4f9e86" },
  { shade: "#1f6f9c", glow: "#38a8e8", core: "#9ad8f5", flat: "#5089b0" },
  { shade: "#a3701f", glow: "#f0a93a", core: "#ffd694", flat: "#b0894f" },
  { shade: "#a32b5f", glow: "#f04b93", core: "#ff9dc4", flat: "#b05f80" },
  { shade: "#5f42a3", glow: "#9a6af0", core: "#c9b3f7", flat: "#7d6bb0" },
  { shade: "#808f22", glow: "#c3d63c", core: "#e2ed95", flat: "#93a05a" },
];

const pitchColors: readonly string[] = [
  "#ff5252",
  "#ff8a50",
  "#ffb300",
  "#ffd740",
  "#c0ca33",
  "#66bb6a",
  "#26c6da",
  "#42a5f5",
  "#5c6bc0",
  "#7e57c2",
  "#ab47bc",
  "#ec407a",
];

export function trackColor(track: number): NoteColor {
  const color = trackColors[track % trackColors.length];
  return (
    color ?? {
      shade: "#1f8f6d",
      glow: "#35d6a4",
      core: "#8ff0d0",
      flat: "#4f9e86",
    }
  );
}

export function pitchColor(pitch: number): string {
  return pitchColors[pitch % 12] ?? "#ff5252";
}
