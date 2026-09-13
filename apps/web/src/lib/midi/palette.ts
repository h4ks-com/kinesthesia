// A track's colour is one of the settings that belong to it, so it is stored
// and shared with the rest of them rather than beside them.
import type { SongVoicing } from "@/lib/audio/voicing";

export type NoteColor = {
  /** What to call the entry, since two of them are greens and a swatch a
   * reader cannot see needs saying rather than numbering. */
  readonly name: string;
  /** The deep end of the hue, carrying the trailing edge of a note so the bar
   * has tonal range rather than reading as one flat colour. */
  readonly shade: string;
  readonly glow: string;
  readonly core: string;
  /** One muted tone for the plain style, which fills a note flat instead of
   * ramping it. */
  readonly flat: string;
};

const teal: NoteColor = {
  name: "Teal",
  shade: "#1f8f6d",
  glow: "#35d6a4",
  core: "#8ff0d0",
  flat: "#4f9e86",
};

/** Ordered so neighbouring tracks land far apart on the colour wheel, since a
 * song's parts are numbered in the order they appear and adjacent hues on
 * adjacent tracks are the pair hardest to tell apart on the roll. */
const trackColors: readonly NoteColor[] = [
  teal,
  {
    name: "Amber",
    shade: "#a3701f",
    glow: "#f0a93a",
    core: "#ffd694",
    flat: "#b0894f",
  },
  {
    name: "Violet",
    shade: "#5f42a3",
    glow: "#9a6af0",
    core: "#c9b3f7",
    flat: "#7d6bb0",
  },
  {
    name: "Lime",
    shade: "#808f22",
    glow: "#c3d63c",
    core: "#e2ed95",
    flat: "#93a05a",
  },
  {
    name: "Blue",
    shade: "#1f6f9c",
    glow: "#38a8e8",
    core: "#9ad8f5",
    flat: "#5089b0",
  },
  {
    name: "Red",
    shade: "#8f251f",
    glow: "#e8483c",
    core: "#f7a49d",
    flat: "#b0605a",
  },
  {
    name: "Green",
    shade: "#1f8f2f",
    glow: "#3ce857",
    core: "#a4f7b0",
    flat: "#5aa066",
  },
  {
    name: "Pink",
    shade: "#a32b5f",
    glow: "#f04b93",
    core: "#ff9dc4",
    flat: "#b05f80",
  },
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

export const trackColorCount = trackColors.length;

/** Where a slot lands in the palette, which is the one rule for reading a
 * stored colour: the list wraps, and it wraps the same way in both
 * directions. */
export function paletteSlot(slot: number): number {
  return ((slot % trackColorCount) + trackColorCount) % trackColorCount;
}

export function paletteColor(slot: number): NoteColor {
  return trackColors[paletteSlot(slot)] ?? teal;
}

/** The entry a track takes when nothing says otherwise: its own position, so
 * neighbouring tracks land far apart. */
export function homeSlot(track: number): number {
  return paletteSlot(track);
}

/** The entry a track is drawn in: whichever the song says, and its own where
 * the song says nothing. One rule, so the roll, the map, the menus and a
 * render cannot disagree about what colour a channel is. */
export function trackSlot(track: number, voicing: SongVoicing): number {
  const chosen = voicing.get(track)?.color;
  return chosen === undefined ? homeSlot(track) : paletteSlot(chosen);
}

export function trackColor(track: number, voicing: SongVoicing): NoteColor {
  return paletteColor(trackSlot(track, voicing));
}

export function pitchColor(pitch: number): string {
  return pitchColors[pitch % 12] ?? "#ff5252";
}
