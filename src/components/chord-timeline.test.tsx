import { fireEvent, render, screen, within } from "@testing-library/react";
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

    const bars = container.querySelectorAll('[role="listbox"] > div');
    expect(bars).toHaveLength(2);
    // The held C spans 8 of the 10 seconds, four times the G that follows it.
    const first = (bars[0] as HTMLElement).style.flexGrow;
    const second = (bars[1] as HTMLElement).style.flexGrow;
    expect(Number(first)).toBeCloseTo(8);
    expect(Number(second)).toBeCloseTo(2);
  });

  // Every chord is named to a screen reader, including the crowded ones the
  // bar has no room to print.
  it("names every chord and its span, whether or not the bar prints it", () => {
    render(
      <ChordTimeline
        timeline={[
          { at: 0, chord: "C" },
          { at: 8, chord: "G" },
        ]}
        duration={10}
      />,
    );

    expect(
      screen.getByRole("option", { name: "C, 0:00 to 0:08" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("option", { name: "G, 0:08 to 0:10" }),
    ).toBeTruthy();
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

    const bar = container.querySelector('[role="listbox"]') as HTMLElement;
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

    const bar = container.querySelector('[role="listbox"]') as HTMLElement;
    expect(within(bar).queryByText("F")).toBeNull();
    // Still readable in full, off the visible bar.
    expect(
      screen.getByRole("option", { name: "F, 1:30 to 1:30" }),
    ).toBeTruthy();
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

    expect(
      screen.getByRole("option", { name: "Silence, 0:00 to 0:05" }),
    ).toBeTruthy();
    const bar = container.querySelector('[role="listbox"]') as HTMLElement;
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

  // A crowded stretch prints no name on the bar, so without this a listener
  // with no mouse cannot read one at all: the tooltip the pointer gets never
  // reaches a keyboard.
  it("reads a chord out by the arrow keys, not only under the pointer", () => {
    const { container } = render(
      <ChordTimeline
        timeline={[
          { at: 0, chord: "C" },
          { at: 4, chord: "G7" },
        ]}
        duration={8}
      />,
    );
    const bar = screen.getByRole("listbox", { name: "Chord progression" });
    const readout = container.querySelector('[aria-live="polite"]');

    expect(readout?.textContent).toContain("0:00");

    fireEvent.keyDown(bar, { key: "ArrowRight" });
    expect(readout?.textContent).toContain("C");

    fireEvent.keyDown(bar, { key: "ArrowRight" });
    expect(readout?.textContent).toContain("G7");
    expect(readout?.textContent).toContain("0:04 to 0:08");

    fireEvent.blur(bar);
    expect(readout?.textContent).toContain("0:00");
  });
});
