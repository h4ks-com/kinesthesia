import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimingRail } from "@/components/timing-rail";
import { keyboardHeightRatio, maxKeyboardHeight } from "@/lib/render/keyboard";
import { enoughForHabit } from "@/lib/scoring/rail";
import type { Hit } from "@/lib/scoring/use-gates";

function hit(away: number | null, seq: number): Hit {
  return { judgement: away === null ? "miss" : "perfect", away, seq };
}

/** Where each tick sits along the rail, as a fraction, in the order drawn. */
function ticks(container: HTMLElement): number[] {
  return [...container.querySelectorAll<HTMLElement>("[data-tick]")].map(
    (tick) => Number.parseFloat(tick.style.top),
  );
}

function marker(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>(".bg-accent");
}

/** How strongly each tick is drawn, in the order drawn. */
function strengths(container: HTMLElement): number[] {
  return [...container.querySelectorAll<HTMLElement>("[data-tick]")].map(
    (tick) => Number.parseFloat(tick.style.opacity),
  );
}

function struck(view: ReturnType<typeof render>, upTo: number): void {
  for (let seq = 2; seq <= upTo; seq += 1) {
    view.rerender(<TimingRail hit={hit(0.02, seq)} />);
  }
}

describe("TimingRail", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // The bands are where a player learns to look, so they are there to be looked
  // at before the first note is judged.
  it("stands with nothing on it until something has been struck", () => {
    const { container } = render(<TimingRail hit={null} />);
    expect(container.querySelector("[data-rail]")).not.toBeNull();
    expect(ticks(container)).toHaveLength(0);
  });

  // The roll draws the keys over the foot of the same box, so a rail measured
  // off anything but the keybed lands on top of them.
  it("stops short of the keys, by whatever height they are given", () => {
    const { container } = render(<TimingRail hit={hit(0.02, 1)} />);
    const rail = container.querySelector<HTMLElement>("[data-rail]");
    expect(rail?.style.bottom).toContain(`${maxKeyboardHeight}px`);
    expect(rail?.style.bottom).toContain(`${keyboardHeightRatio * 100}%`);
  });

  it("marks a strike further along the later it landed", () => {
    const view = render(<TimingRail hit={hit(-0.1, 1)} />);
    const early = ticks(view.container)[0] ?? 0;
    view.rerender(<TimingRail hit={hit(0.1, 2)} />);
    const both = ticks(view.container);
    expect(both).toHaveLength(2);
    expect(early).toBeLessThan(50);
    expect(both[1] ?? 0).toBeGreaterThan(50);
  });

  it("puts a strike on the beat in the middle", () => {
    const { container } = render(<TimingRail hit={hit(0, 1)} />);
    expect(ticks(container)[0]).toBeCloseTo(50, 5);
  });

  // A miss has no beat to measure against, and a rail full of them would say
  // the player was on time.
  it("ignores a strike that answered nothing", () => {
    const { container } = render(<TimingRail hit={hit(null, 1)} />);
    expect(ticks(container)).toHaveLength(0);
  });

  it("takes a strike once however often it is handed the same one", () => {
    const same = hit(0.05, 7);
    const view = render(<TimingRail hit={same} />);
    view.rerender(<TimingRail hit={same} />);
    view.rerender(<TimingRail hit={{ ...same }} />);
    expect(ticks(view.container)).toHaveLength(1);
  });

  it("lets go of every mark, not only the last one", () => {
    const view = render(<TimingRail hit={hit(0.02, 1)} />);
    for (let seq = 2; seq <= 6; seq += 1) {
      view.rerender(<TimingRail hit={hit(0.02, seq)} />);
    }
    expect(ticks(view.container)).toHaveLength(6);
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(ticks(view.container)).toHaveLength(0);
  });

  it("keeps letting go when a strike answering nothing lands between", () => {
    const view = render(<TimingRail hit={hit(0.02, 1)} />);
    view.rerender(<TimingRail hit={hit(null, 2)} />);
    view.rerender(<TimingRail hit={hit(0.03, 3)} />);
    expect(ticks(view.container)).toHaveLength(2);
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(ticks(view.container)).toHaveLength(0);
  });

  it("lets each reading go on its own age, oldest first", () => {
    const view = render(<TimingRail hit={hit(-0.1, 1)} />);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    view.rerender(<TimingRail hit={hit(0.1, 2)} />);
    expect(ticks(view.container)).toHaveLength(2);
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    const left = ticks(view.container);
    expect(left).toHaveLength(1);
    expect(left[0] ?? 0).toBeGreaterThan(50);
  });

  it("dims a reading as strikes stack up behind it", () => {
    const view = render(<TimingRail hit={hit(0.02, 1)} />);
    const alone = strengths(view.container)[0] ?? 0;
    struck(view, 4);
    const crowded = strengths(view.container);
    expect(alone).toBeCloseTo(1, 5);
    expect(crowded[0] ?? 1).toBeLessThan(alone);
    expect(crowded[crowded.length - 1] ?? 0).toBeCloseTo(1, 5);
  });

  it("lets a mark go once it has aged out", () => {
    const view = render(<TimingRail hit={hit(0.02, 1)} />);
    expect(ticks(view.container)).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(ticks(view.container)).toHaveLength(0);
  });

  it("holds back the habit marker until it has enough to read one", () => {
    const view = render(<TimingRail hit={hit(-0.05, 1)} />);
    expect(marker(view.container)).toBeNull();
    for (let seq = 2; seq <= enoughForHabit; seq += 1) {
      view.rerender(<TimingRail hit={hit(-0.05, seq)} />);
    }
    expect(marker(view.container)).not.toBeNull();
  });

  it("leans the habit marker toward the side the player keeps landing on", () => {
    const view = render(<TimingRail hit={hit(-0.09, 1)} />);
    for (let seq = 2; seq <= enoughForHabit; seq += 1) {
      view.rerender(<TimingRail hit={hit(-0.09, seq)} />);
    }
    const rushing = Number.parseFloat(
      marker(view.container)?.style.top ?? "50",
    );
    expect(rushing).toBeLessThan(50);
  });
});
