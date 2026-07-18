export type NoteColor = {
  readonly glow: string;
  readonly core: string;
};

const trackColors: readonly NoteColor[] = [
  { glow: "#3ad19c", core: "#e7fff5" },
  { glow: "#3a9cd1", core: "#e3f5ff" },
  { glow: "#e0a83a", core: "#fff2d6" },
  { glow: "#e03a8f", core: "#ffd6ec" },
  { glow: "#9c5ad1", core: "#ecd9ff" },
  { glow: "#c9d13a", core: "#f8ffd6" },
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
  return color ?? { glow: "#3ad19c", core: "#e7fff5" };
}

export function pitchColor(pitch: number): string {
  return pitchColors[pitch % 12] ?? "#ff5252";
}
