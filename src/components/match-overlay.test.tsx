import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  MatchOverlay,
  type MatchOverlayProps,
} from "@/components/match-overlay";
import { emptyShape } from "@/lib/scoring/rail";
import type { Summary } from "@/lib/scoring/summary";

function summary(over: Partial<Summary> = {}): Summary {
  return {
    points: 1000,
    notes: 1,
    accuracy: 1,
    streak: 8,
    spread: 0.02,
    shape: emptyShape,
    ...over,
  };
}

function overlay(over: Partial<MatchOverlayProps> = {}) {
  return render(
    <MatchOverlay
      phase="result"
      count={3}
      songReady
      myReady
      myPoints={1000}
      theirPoints={800}
      mySummary={null}
      theirSummary={null}
      opponentName="valware"
      coop={false}
      opponentReady
      opponentDone
      opponentGone={false}
      myRematch={false}
      theirRematch={false}
      onReady={() => {}}
      onRematch={() => {}}
      {...over}
    />,
  );
}

describe("MatchOverlay", () => {
  it("stays out of the way while a round is running", () => {
    const { container } = overlay({ phase: "playing" });
    expect(container.firstChild).toBeNull();
  });

  it("names the winner once both sides are in", () => {
    const { container } = overlay({ myPoints: 1200, theirPoints: 900 });
    expect(container.textContent).toContain("You win");
  });

  it("waits rather than declaring anything while one side is still playing", () => {
    const { container } = overlay({ opponentDone: false });
    expect(container.textContent).toContain("Waiting for the other player");
    expect(container.textContent).not.toContain("You win");
  });

  it("reads out both runs once they have been sent", () => {
    const { container } = overlay({
      mySummary: summary({ points: 1200, streak: 41 }),
      theirSummary: summary({ points: 900, streak: 27 }),
    });
    expect(container.textContent).toContain("41");
    expect(container.textContent).toContain("27");
  });

  // A rematch clears both summaries, so the card must fall back rather than
  // set this round against whatever the other player did in the last one.
  it("falls back to the plain tally when a round has no card yet", () => {
    const { container } = overlay({ mySummary: null, theirSummary: null });
    expect(container.textContent).toContain("you 1000");
    expect(container.textContent).toContain("them 800");
  });

  it("shows only this side while the other side's card is still coming", () => {
    const { container } = overlay({
      mySummary: summary({ points: 1200, streak: 41 }),
      theirSummary: null,
    });
    expect(container.textContent).toContain("41");
    expect(container.textContent).not.toContain("valware");
  });

  it("adds the two together in co-op instead of naming a winner", () => {
    const { container } = overlay({
      coop: true,
      mySummary: summary({ points: 1200 }),
      theirSummary: summary({ points: 900 }),
    });
    expect(container.textContent).toContain("band score");
    expect(container.textContent).toContain("2,100");
  });

  it("says so plainly when the other player leaves", () => {
    const { container } = overlay({ opponentGone: true });
    expect(container.textContent).toContain("The other player left");
  });

  it("counts down before a round rather than showing a result", () => {
    const { container } = overlay({ phase: "countdown", count: 2 });
    expect(container.textContent).toContain("2");
    expect(container.textContent).not.toContain("You win");
  });
});
