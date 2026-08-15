import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChordTimeline } from "@/components/chord-timeline";

describe("ChordTimeline", () => {
  it("sizes each segment by how long it holds, not by its place in the list", () => {
    const { container } = render(
      <ChordTimeline
        timeline={[
          { at: 0, chord: "C" },
          { at: 8, chord: "G" },
        ]}
        duration={10}
      />,
    );

    const bars = container.querySelectorAll('[aria-hidden="true"] > div');
    expect(bars).toHaveLength(2);
    // The held C spans 8 of the 10 seconds, four times the G that follows it.
    const first = (bars[0] as HTMLElement).style.flexGrow;
    const second = (bars[1] as HTMLElement).style.flexGrow;
    expect(Number(first)).toBeCloseTo(8);
    expect(Number(second)).toBeCloseTo(2);
  });

  it("lists the whole progression as a screen-reader-only list of chord and time", () => {
    render(
      <ChordTimeline
        timeline={[
          { at: 0, chord: "C" },
          { at: 8, chord: "G" },
        ]}
        duration={10}
      />,
    );

    expect(screen.getByText("C, 0:00 to 0:08")).toBeTruthy();
    expect(screen.getByText("G, 0:08 to 0:10")).toBeTruthy();
  });

  it("names a chord on the bar once it holds enough of the timeline to read", () => {
    const { container } = render(
      <ChordTimeline
        timeline={[
          { at: 0, chord: "C" },
          { at: 8, chord: "G" },
        ]}
        duration={10}
      />,
    );

    const bar = container.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(within(bar).getByText("C")).toBeTruthy();
    expect(within(bar).getByText("G")).toBeTruthy();
  });

  it("keeps a crowded chord's colour but drops its label rather than overlapping text", () => {
    const timeline = [
      { at: 0, chord: "C" },
      { at: 90, chord: "G" },
      // A quarter second among 100: far under the label threshold.
      { at: 90.25, chord: "F" },
      { at: 90.5, chord: "C" },
    ];
    const { container } = render(
      <ChordTimeline timeline={timeline} duration={100} />,
    );

    const bar = container.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(within(bar).queryByText("F")).toBeNull();
    // Still readable in full, off the visible bar.
    expect(screen.getByText("F, 1:30 to 1:30")).toBeTruthy();
  });

  it("draws silence distinctly from a named chord", () => {
    const { container } = render(
      <ChordTimeline
        timeline={[
          { at: 0, chord: null },
          { at: 5, chord: "C" },
        ]}
        duration={10}
      />,
    );

    expect(screen.getByText("Silence, 0:00 to 0:05")).toBeTruthy();
    const bar = container.querySelector('[aria-hidden="true"]') as HTMLElement;
    const silent = bar.firstElementChild as HTMLElement;
    expect(silent.style.background).toBe("var(--color-raised)");
  });

  it("says so, without throwing, when the progression is empty", () => {
    render(<ChordTimeline timeline={[]} duration={90} />);

    expect(screen.getByText("No chords detected.")).toBeTruthy();
  });

  it("says so for a song with no duration rather than divide by zero", () => {
    render(<ChordTimeline timeline={[{ at: 0, chord: "C" }]} duration={0} />);

    expect(screen.getByText("No chords detected.")).toBeTruthy();
  });
});
