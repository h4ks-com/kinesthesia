import { describe, expect, it } from "vitest";
import {
  type BattleMessage,
  battleOutcome,
  isBattleMessage,
} from "@/lib/battle/protocol";

describe("battleOutcome", () => {
  it("reads more points as a win", () => {
    expect(battleOutcome(1200, 980)).toBe("win");
  });

  it("reads fewer points as a loss", () => {
    expect(battleOutcome(700, 900)).toBe("loss");
  });

  it("reads equal points as a draw", () => {
    expect(battleOutcome(500, 500)).toBe("draw");
  });
});

describe("isBattleMessage", () => {
  it("accepts the sync messages", () => {
    const messages: BattleMessage[] = [
      { kind: "ready" },
      { kind: "begin", round: 1 },
      { kind: "rematch" },
      { kind: "finished", points: 10 },
      { kind: "ping" },
    ];
    for (const message of messages) {
      expect(isBattleMessage(message)).toBe(true);
    }
  });

  it("rejects anything without a known kind", () => {
    expect(isBattleMessage({ kind: "nope" })).toBe(false);
    expect(isBattleMessage(null)).toBe(false);
    expect(isBattleMessage("begin")).toBe(false);
  });
});
