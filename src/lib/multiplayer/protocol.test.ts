import { describe, expect, it } from "vitest";
import {
  battleOutcome,
  isMatchMessage,
  type MatchMessage,
} from "@/lib/multiplayer/protocol";

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

describe("isMatchMessage", () => {
  it("accepts the sync messages", () => {
    const messages: MatchMessage[] = [
      { kind: "ready" },
      { kind: "begin", round: 1 },
      { kind: "rematch" },
      { kind: "finished", points: 10 },
      { kind: "ping" },
    ];
    for (const message of messages) {
      expect(isMatchMessage(message)).toBe(true);
    }
  });

  it("rejects anything without a known kind", () => {
    expect(isMatchMessage({ kind: "nope" })).toBe(false);
    expect(isMatchMessage(null)).toBe(false);
    expect(isMatchMessage("begin")).toBe(false);
  });
});
