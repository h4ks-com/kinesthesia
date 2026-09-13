import type { MelodyRate } from "@/lib/midi/melody";
import type { PlayerParams, Speed } from "@/lib/player-url";

/** What a recorded run actually was: the route is `multiplayer`, but a run is
 * kept as the competitive `battle` or the shared `coop` so a win-loss record
 * can tell them apart. */
export type RecordedMode = "learn" | "battle" | "coop";

export type ScoreSubmission = {
  song: string;
  url: string;
  mode: RecordedMode;
  points: number;
  accuracy: number;
  bestCombo: number;
  speed: Speed;
  simplified: boolean;
  melodyRate: MelodyRate | null;
};

type Settings = Pick<
  PlayerParams,
  "name" | "url" | "speed" | "simplified" | "melodyRate"
>;

type Stats = {
  points: number;
  accuracy: number;
  bestCombo: number;
};

export function scoreSubmission(
  settings: Settings,
  mode: RecordedMode,
  stats: Stats,
): ScoreSubmission {
  return {
    song: settings.name,
    url: settings.url,
    mode,
    points: stats.points,
    accuracy: stats.accuracy,
    bestCombo: stats.bestCombo,
    speed: settings.speed,
    simplified: settings.simplified,
    melodyRate: settings.simplified ? settings.melodyRate : null,
  };
}
