import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimingRail } from "@/components/timing-rail";
import { enoughForHabit } from "@/lib/scoring/rail";
import type { Hit } from "@/lib/scoring/use-gates";

function hit(away: number | null, seq: number): Hit {
  return { judgement: away === null ? "miss" : "perfect", away, seq };
}

/** Where each tick sits along the rail, as a fraction, in the order drawn. */
function ticks(container: HTMLElement, upright: boolean): number[] {
  return [...container.querySelectorAll<HTMLElement>(".fade-out")].map((tick) =>
    Number.parseFloat(upright ? tick.style.top : tick.style.left),
  );
}

function marker(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>(".bg-accent");
}

describe("TimingRail", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows nothing until something has been struck", () => {
    const { container } = render(<TimingRail hit={null} lie="upright" />);
    expect(container.firstChild).toBeNull();
  });

  it("marks a strike further along the later it landed", () => {
    const view = render(<TimingRail hit={hit(-0.1, 1)} lie="upright" />);
    const early = ticks(view.container, true)[0] ?? 0;
    view.rerender(<TimingRail hit={hit(0.1, 2)} lie="upright" />);
    const both = ticks(view.container, true);
    expect(both).toHaveLength(2);
    expect(early).toBeLessThan(50);
    expect(both[1] ?? 0).toBeGreaterThan(50);
  });

  it("puts a strike on the beat in the middle", () => {
    const { container } = render(<TimingRail hit={hit(0, 1)} lie="upright" />);
    expect(ticks(container, true)[0]).toBeCloseTo(50, 5);
  });

  it("lays the marks the other way once the rolls stack", () => {
    const { container } = render(<TimingRail hit={hit(0.1, 1)} lie="flat" />);
    const tick = container.querySelector<HTMLElement>(".fade-out");
    expect(tick?.style.left).not.toBe("");
    expect(tick?.style.top).toBe("");
    expect(ticks(container, false)[0] ?? 0).toBeGreaterThan(50);
  });

  // A miss has no beat to measure against, and a rail full of them would say
  // the player was on time.
  it("ignores a strike that answered nothing", () => {
    const { container } = render(
      <TimingRail hit={hit(null, 1)} lie="upright" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("takes a strike once however often it is handed the same one", () => {
    const same = hit(0.05, 7);
    const view = render(<TimingRail hit={same} lie="upright" />);
    view.rerender(<TimingRail hit={same} lie="upright" />);
    view.rerender(<TimingRail hit={{ ...same }} lie="upright" />);
    expect(ticks(view.container, true)).toHaveLength(1);
  });

  // The bug this replaces: each strike's cleanup cancelled the removal of the
  // one before it, so every mark but the newest stayed on the rail for good.
  it("lets go of every mark, not only the last one", () => {
    const view = render(<TimingRail hit={hit(0.02, 1)} lie="upright" />);
    for (let seq = 2; seq <= 6; seq += 1) {
      view.rerender(<TimingRail hit={hit(0.02, seq)} lie="upright" />);
    }
    expect(ticks(view.container, true)).toHaveLength(6);
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(view.container.firstChild).toBeNull();
  });

  it("keeps letting go when a strike answering nothing lands between", () => {
    const view = render(<TimingRail hit={hit(0.02, 1)} lie="upright" />);
    view.rerender(<TimingRail hit={hit(null, 2)} lie="upright" />);
    view.rerender(<TimingRail hit={hit(0.03, 3)} lie="upright" />);
    expect(ticks(view.container, true)).toHaveLength(2);
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(view.container.firstChild).toBeNull();
  });

  it("lets a mark go once it has aged out", () => {
    const view = render(<TimingRail hit={hit(0.02, 1)} lie="upright" />);
    expect(ticks(view.container, true)).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(view.container.firstChild).toBeNull();
  });

  it("holds back the habit marker until it has enough to read one", () => {
    const view = render(<TimingRail hit={hit(-0.05, 1)} lie="upright" />);
    expect(marker(view.container)).toBeNull();
    for (let seq = 2; seq <= enoughForHabit; seq += 1) {
      view.rerender(<TimingRail hit={hit(-0.05, seq)} lie="upright" />);
    }
    expect(marker(view.container)).not.toBeNull();
  });

  it("leans the habit marker toward the side the player keeps landing on", () => {
    const view = render(<TimingRail hit={hit(-0.09, 1)} lie="upright" />);
    for (let seq = 2; seq <= enoughForHabit; seq += 1) {
      view.rerender(<TimingRail hit={hit(-0.09, seq)} lie="upright" />);
    }
    const rushing = Number.parseFloat(
      marker(view.container)?.style.top ?? "50",
    );
    expect(rushing).toBeLessThan(50);
  });
});
