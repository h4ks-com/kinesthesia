import type { Judgement, Score } from "@/lib/scoring/judge";

export type MatchMessage =
  | {
      readonly kind: "hello";
      readonly name: string;
      /** The sender's part, so their roll is drawn the way they see it: a co-op
       * hands each side a different one. */
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
  /** Both sides roll from the same start on their own clock, so only the
   * running score crosses the wire. */
  | {
      readonly kind: "score";
      readonly score: Score;
      readonly points: number;
      readonly accuracy: number;
    }
  /** One per judged note, so the other side can flash the same hit or miss. */
  | { readonly kind: "hit"; readonly judgement: Judgement }
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
  readonly finished: boolean;
};

export const noOpponent: Opponent = {
  name: "Opponent",
  points: 0,
  accuracy: 1,
  combo: 0,
  finished: false,
};

const kinds = [
  "hello",
  "ready",
  "begin",
  "score",
  "hit",
  "finished",
  "rematch",
  "ping",
];

export function isMatchMessage(value: unknown): value is MatchMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const kind = (value as { kind?: unknown }).kind;
  return typeof kind === "string" && kinds.includes(kind);
}
