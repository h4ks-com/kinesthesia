import type { Score } from "@/lib/scoring/judge";

export type BattleMessage =
  | {
      readonly kind: "hello";
      readonly name: string;
      /** What the sender owes, so their roll can be drawn the way they see it
       * rather than as the whole part. */
      readonly simplified?: boolean;
      readonly melodyRate?: number;
      readonly tracks?: readonly number[];
    }
  /** Sent once a side has unlocked its audio and is set to play, since a
   * browser only starts sound from a tap and both must be armed to stay level. */
  | { readonly kind: "ready" }
  /** The host owns the clock, so both sides start a round from this one
   * message and no one can drift the match by starting on their own. */
  | { readonly kind: "begin"; readonly round: number }
  | {
      readonly kind: "score";
      readonly score: Score;
      readonly points: number;
      readonly accuracy: number;
      readonly position: number;
    }
  | { readonly kind: "press"; readonly pitch: number }
  | { readonly kind: "release"; readonly pitch: number }
  | { readonly kind: "finished"; readonly points: number }
  | { readonly kind: "rematch" }
  /** A closed tab fires no clean disconnect, so each side beats steadily and a
   * silence longer than a few beats is read as the other player gone. */
  | { readonly kind: "ping" };

export type Outcome = "win" | "loss" | "draw";

export function battleOutcome(mine: number, theirs: number): Outcome {
  if (mine > theirs) {
    return "win";
  }
  return mine < theirs ? "loss" : "draw";
}

export type Opponent = {
  readonly name: string;
  readonly points: number;
  readonly accuracy: number;
  readonly combo: number;
  readonly position: number;
  readonly finished: boolean;
};

export const noOpponent: Opponent = {
  name: "Opponent",
  points: 0,
  accuracy: 1,
  combo: 0,
  position: 0,
  finished: false,
};

const kinds = [
  "hello",
  "ready",
  "begin",
  "score",
  "press",
  "release",
  "finished",
  "rematch",
  "ping",
];

export function isBattleMessage(value: unknown): value is BattleMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const kind = (value as { kind?: unknown }).kind;
  return typeof kind === "string" && kinds.includes(kind);
}
