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
  | { readonly kind: "rematch" };

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

const kinds = ["hello", "score", "press", "release", "finished", "rematch"];

export function isBattleMessage(value: unknown): value is BattleMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const kind = (value as { kind?: unknown }).kind;
  return typeof kind === "string" && kinds.includes(kind);
}
