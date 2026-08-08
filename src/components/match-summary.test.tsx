import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MatchSummary } from "@/components/match-summary";
import type { Summary } from "@/lib/scoring/summary";

function summary(over: Partial<Summary> = {}): Summary {
  return {
    points: 1000,
    notes: 1,
    accuracy: 1,
    streak: 10,
    hold: 1,
    spread: 0.02,
    ...over,
  };
}

function shown(container: HTMLElement): string {
  return container.textContent ?? "";
}

describe("MatchSummary", () => {
  it("leads with the score a battle is settled on", () => {
    const { container } = render(
      <MatchSummary
        mine={summary({ points: 10300 })}
        theirs={summary({ points: 8120 })}
        myName="you"
        theirName="valware"
        coop={false}
      />,
    );
    expect(shown(container)).toContain("10,300");
    expect(shown(container)).toContain("8,120");
    expect(shown(container)).toContain("score");
  });

  it("adds both sides up in co-op instead of setting them against each other", () => {
    const { container } = render(
      <MatchSummary
        mine={summary({ points: 10300 })}
        theirs={summary({ points: 8120 })}
        myName="you"
        theirName="valware"
        coop
      />,
    );
    expect(shown(container)).toContain("band score");
    expect(shown(container)).toContain("18,420");
  });

  it("reads the shares as whole percentages", () => {
    const { container } = render(
      <MatchSummary
        mine={summary({ notes: 0.9612, hold: 0.7143 })}
        theirs={null}
        myName="you"
        theirName=""
        coop={false}
      />,
    );
    expect(shown(container)).toContain("96%");
    expect(shown(container)).toContain("71%");
  });

  it("reads timing in milliseconds, not seconds", () => {
    const { container } = render(
      <MatchSummary
        mine={summary({ spread: 0.024 })}
        theirs={null}
        myName="you"
        theirName=""
        coop={false}
      />,
    );
    expect(shown(container)).toContain("24ms");
  });

  // A run on its own has nobody to be read against, and an empty column would
  // read as an opponent who scored nothing.
  it("shows one column when there is no one to compare with", () => {
    const { container } = render(
      <MatchSummary
        mine={summary()}
        theirs={null}
        myName="you"
        theirName=""
        coop={false}
      />,
    );
    expect(container.querySelectorAll(".bg-good\\/5")).toHaveLength(0);
  });

  it("marks whichever side is ahead, not always this one", () => {
    const behind = render(
      <MatchSummary
        mine={summary({ points: 10 })}
        theirs={summary({ points: 99 })}
        myName="you"
        theirName="them"
        coop={false}
      />,
    );
    const lit = behind.container.querySelectorAll(".bg-good\\/5");
    expect(lit).toHaveLength(1);
    expect(lit[0]?.textContent).toContain("them");
  });

  it("names every row it shows a number for", () => {
    const { container } = render(
      <MatchSummary
        mine={summary()}
        theirs={null}
        myName="you"
        theirName=""
        coop={false}
      />,
    );
    for (const label of ["notes", "streak", "hold", "timing"]) {
      expect(shown(container)).toContain(label);
    }
  });
});
