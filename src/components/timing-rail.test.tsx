import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimingRail } from "@/components/timing-rail";
import { enoughForHabit } from "@/lib/scoring/rail";
import type { Hit } from "@/lib/scoring/use-gates";

function hit(away: number | null, seq: number): Hit {
  return { judgement: away === null ? "miss" : "perfect", away, seq };
}

/** Where each tick sits along the rail, as a fraction, in the order drawn. */
function ticks(container: HTMLElement): number[] {
  return [...container.querySelectorAll<HTMLElement>(".fade-out")].map((tick) =>
    Number.parseFloat(tick.style.top),
  );
}

function marker(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>(".bg-accent");
}

/** How strongly each tick is drawn, in the order drawn. */
function strengths(container: HTMLElement): number[] {
  return [...container.querySelectorAll<HTMLElement>(".fade-out")].map((tick) =>
    Number.parseFloat(tick.style.opacity),
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

  it("shows nothing until something has been struck", () => {
    const { container } = render(<TimingRail hit={null} />);
    expect(container.firstChild).toBeNull();
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
    expect(container.firstChild).toBeNull();
  });

  it("takes a strike once however often it is handed the same one", () => {
    const same = hit(0.05, 7);
    const view = render(<TimingRail hit={same} />);
    view.rerender(<TimingRail hit={same} />);
    view.rerender(<TimingRail hit={{ ...same }} />);
    expect(ticks(view.container)).toHaveLength(1);
  });

  // The bug this replaces: each strike's cleanup cancelled the removal of the
  // one before it, so every mark but the newest stayed on the rail for good.
  it("lets go of every mark, not only the last one", () => {
    const view = render(<TimingRail hit={hit(0.02, 1)} />);
    for (let seq = 2; seq <= 6; seq += 1) {
      view.rerender(<TimingRail hit={hit(0.02, seq)} />);
    }
    expect(ticks(view.container)).toHaveLength(6);
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(view.container.firstChild).toBeNull();
  });

  it("keeps letting go when a strike answering nothing lands between", () => {
    const view = render(<TimingRail hit={hit(0.02, 1)} />);
    view.rerender(<TimingRail hit={hit(null, 2)} />);
    view.rerender(<TimingRail hit={hit(0.03, 3)} />);
    expect(ticks(view.container)).toHaveLength(2);
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(view.container.firstChild).toBeNull();
  });

  // What the fade is measured against: a reading holds a share of the rail's
  // time, so more of them means each one goes sooner.
  it("clears a crowded rail quicker than a lone reading", () => {
    const lone = render(<TimingRail hit={hit(0.02, 1)} />);
    const busy = render(<TimingRail hit={hit(0.02, 1)} />);
    struck(busy, 8);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(ticks(lone.container)).toHaveLength(1);
    expect(ticks(busy.container).length).toBeLessThan(8);
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
    expect(view.container.firstChild).toBeNull();
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
