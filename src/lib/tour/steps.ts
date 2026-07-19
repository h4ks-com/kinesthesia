import type { PlayerMode } from "@/lib/player-url";

export type TourStep = {
  /** The `data-tour` element the step points at. A step whose anchor is not on
   * the page is skipped, so one list serves a mode that hides some controls. */
  readonly anchor: string;
  readonly title: string;
  readonly body: string;
};

const watch: readonly TourStep[] = [
  {
    anchor: "tracks",
    title: "Tracks",
    body: "Show or hide any track, solo one to hear it alone, or open a track to change its instrument and shape its sound.",
  },
  {
    anchor: "speed",
    title: "Speed",
    body: "Slow a fast song down to follow it, or push it faster.",
  },
  {
    anchor: "transpose",
    title: "Key",
    body: "Shift the whole song up or down to a key that suits you.",
  },
  {
    anchor: "focus",
    title: "Focus",
    body: "Strip the page back to the keys and the falling notes, for a clean recording. Esc brings the controls back.",
  },
  {
    anchor: "modes",
    title: "Play it yourself",
    body: "Switch to Learn to play along at your own pace, or Multiplayer to play with someone.",
  },
];

const learn: readonly TourStep[] = [
  {
    anchor: "tracks",
    title: "Your part",
    body: "Pick the track you play. Hide the rest, solo one to hear it, or open a track to change how it sounds.",
  },
  {
    anchor: "simplify",
    title: "Make it easier",
    body: "Reduce your part to one note at a time when a passage has too many.",
  },
  {
    anchor: "play",
    title: "It waits for you",
    body: "Press play, or the space bar. The song holds at each note until you hit the right key.",
  },
  {
    anchor: "speed",
    title: "Speed",
    body: "Slow it down while a passage is still new.",
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
    anchor: "tracks",
    title: "Your side",
    body: "Choose the track you play and how it sounds. Their side is set on the right.",
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
