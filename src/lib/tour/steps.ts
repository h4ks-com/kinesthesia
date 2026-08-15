import type { PlayerMode } from "@/lib/player-url";

export type TourStep = {
  /** The `data-tour` element the step points at. A step whose anchor is not on
   * the page is skipped, so one list serves a mode that hides some controls. */
  readonly anchor: string;
  readonly title: string;
  readonly body: string;
  /** A `data-tour` popover trigger to hold open for this step, so the tour can
   * point at what lives inside it. */
  readonly open?: string;
};

const watch: readonly TourStep[] = [
  {
    anchor: "track-list",
    open: "tracks",
    title: "Tracks",
    body: "Every track in the song. Hide the ones you don't want, or solo one to hear it alone.",
  },
  {
    anchor: "track-sound",
    open: "tracks",
    title: "Change the sound",
    body: "Open a track to pick its instrument and shape how it sounds.",
  },
  {
    anchor: "view",
    title: "Sheet music",
    body: "Switch between the falling notes, the sheet, or both at once.",
  },
  {
    anchor: "song-menu",
    title: "This song",
    body: "Click the title for song info, the MIDI file, a link to copy, or to save it as a favorite.",
  },
  {
    anchor: "focus",
    title: "Focus",
    body: "Strip the page back to the keys and the falling notes, for a clean recording. Esc brings the controls back.",
  },
  {
    anchor: "modes",
    title: "Play it yourself",
    body: "One control for the mode. Pick Learn to play along at your own pace, or Multiplayer to play with someone.",
  },
];

const learn: readonly TourStep[] = [
  {
    anchor: "track-list",
    open: "tracks",
    title: "Your part",
    body: "The song's tracks. Hide the ones you're not playing, or solo one to hear it alone.",
  },
  {
    anchor: "track-claim",
    open: "tracks",
    title: "Pick what you play",
    body: "A hand marks the track you play. The rest play themselves.",
  },
  {
    anchor: "track-sound",
    open: "tracks",
    title: "Change the sound",
    body: "Open a track to pick its instrument and shape how it sounds.",
  },
  {
    anchor: "simplify",
    title: "Make it easier",
    body: "Reduce your part to one note at a time when a passage has too many.",
  },
  {
    anchor: "hand",
    title: "Practice one hand",
    body: "Play just the left hand, just the right, or both together.",
  },
  {
    anchor: "play",
    title: "It waits for you",
    body: "Press play, or the space bar. The song holds at each note until you hit the right key.",
  },
  {
    anchor: "modes",
    title: "More ways to play",
    body: "Watch it played back, or take on someone in Multiplayer.",
  },
];

const multiplayer: readonly TourStep[] = [
  {
    anchor: "opponent",
    title: "The other player",
    body: "Set their side here. Battle gives you both the same part; Co-op lets each of you play a different one.",
  },
  {
    anchor: "track-list",
    open: "tracks",
    title: "Your side",
    body: "The tracks you play. Hide the rest, or solo one to hear it alone.",
  },
  {
    anchor: "track-sound",
    open: "tracks",
    title: "Change the sound",
    body: "Open a track to pick its instrument and shape how it sounds.",
  },
  {
    anchor: "speed",
    title: "Shared for both",
    body: "Speed and key are the same for both players, so you roll together.",
  },
  {
    anchor: "invite",
    title: "Send the invite",
    body: "When both sides are set, send the link. From then the setup locks and the round can start.",
  },
];

const byMode: Record<PlayerMode, readonly TourStep[]> = {
  watch,
  learn,
  multiplayer,
};

export function tourFor(mode: PlayerMode): readonly TourStep[] {
  return byMode[mode];
}
