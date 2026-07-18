import type { Score } from "@/lib/scoring/judge";

export type BattleMessage =
  | { readonly kind: "hello"; readonly name: string }
  | {
      readonly kind: "score";
      readonly score: Score;
      readonly points: number;
      readonly accuracy: number;
    }
  | { readonly kind: "finished"; readonly points: number }
  | { readonly kind: "rematch" };

export type Opponent = {
  readonly name: string;
  readonly points: number;
  readonly accuracy: number;
  readonly finished: boolean;
};

export function isBattleMessage(value: unknown): value is BattleMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const kind = (value as { kind?: unknown }).kind;
  return (
    kind === "hello" ||
    kind === "score" ||
    kind === "finished" ||
    kind === "rematch"
  );
}
