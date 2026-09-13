import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LeadMeter } from "@/components/lead-meter";

/** Which cell is lit, counting from your end. Null when none is. */
function lit(container: HTMLElement): number | null {
  const cells = [...container.querySelectorAll("[data-lead] span > span")];
  const found = cells.findIndex((cell) => cell.hasAttribute("data-lit"));
  return found === -1 ? null : found;
}

function gap(container: HTMLElement): string {
  return (
    container.querySelector("[data-lead] > span + span")?.textContent ?? ""
  );
}

describe("LeadMeter", () => {
  it("draws the whole ramp, so the meaning is on it rather than remembered", () => {
    const { container } = render(<LeadMeter mine={0} theirs={0} />);
    expect(container.querySelectorAll("[data-lead] span > span")).toHaveLength(
      5,
    );
  });

  it("sits in the middle while nothing separates the two", () => {
    const { container } = render(<LeadMeter mine={2400} theirs={2400} />);
    expect(lit(container)).toBe(2);
    expect(gap(container)).toBe("0");
  });

  it("lights your end when you are clear", () => {
    const { container } = render(<LeadMeter mine={4000} theirs={800} />);
    expect(lit(container)).toBe(0);
  });

  it("lights their end when they are", () => {
    const { container } = render(<LeadMeter mine={800} theirs={4000} />);
    expect(lit(container)).toBe(4);
  });

  it("moves toward you as the same gap grows", () => {
    const near = render(<LeadMeter mine={2600} theirs={2400} />);
    const far = render(<LeadMeter mine={4400} theirs={600} />);
    expect(lit(far.container)).toBeLessThan(lit(near.container) ?? 0);
  });

  it("reads out the gap with its sign", () => {
    const ahead = render(<LeadMeter mine={1500} theirs={1220} />);
    expect(gap(ahead.container)).toBe("+280");
    const behind = render(<LeadMeter mine={1220} theirs={1500} />);
    expect(gap(behind.container)).toBe("−280");
  });

  it("is out of the way of anything that reads the page", () => {
    const { container } = render(<LeadMeter mine={10} theirs={0} />);
    expect(
      container.querySelector("[data-lead]")?.getAttribute("aria-hidden"),
    ).toBe("true");
  });
});
