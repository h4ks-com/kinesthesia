import type { MelodyRate } from "@/lib/midi/melody";
import type { PlayerMode, PlayerParams, Speed } from "@/lib/player-url";

export type ScoreSubmission = {
  song: string;
  url: string;
  mode: PlayerMode;
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
  mode: PlayerMode,
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
