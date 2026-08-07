import { render } from "@testing-library/react";
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

  it("lets a mark go once it has aged out", () => {
    const view = render(<TimingRail hit={hit(0.02, 1)} lie="upright" />);
    expect(ticks(view.container, true)).toHaveLength(1);
    vi.advanceTimersByTime(2000);
    view.rerender(<TimingRail hit={hit(0.02, 1)} lie="upright" />);
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
