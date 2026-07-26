import { describe, expect, it } from "vitest";
import { ExpressionTrail, flat } from "@/lib/midi/expression";

describe("ExpressionTrail", () => {
  it("reads flat for a track that never moved a wheel", () => {
    const trail = new ExpressionTrail();
    expect(trail.at(0, 5)).toEqual(flat);
    expect(trail.touched(0)).toBe(false);
  });

  it("holds a wheel at its last value until it moves again", () => {
    const trail = new ExpressionTrail();
    trail.setBend(0, 1, 0.5);
    trail.setBend(0, 3, -0.25);
    expect(trail.at(0, 2).bend).toBe(0.5);
    expect(trail.at(0, 3).bend).toBe(-0.25);
    expect(trail.at(0, 90).bend).toBe(-0.25);
  });

  it("reads flat before the first movement, so a note struck earlier is straight", () => {
    const trail = new ExpressionTrail();
    trail.setBend(0, 4, 1);
    expect(trail.at(0, 2)).toEqual(flat);
  });

  it("keeps the two wheels independent", () => {
    const trail = new ExpressionTrail();
    trail.setBend(0, 1, 0.8);
    trail.setDepth(0, 2, 0.4);
    expect(trail.at(0, 2)).toEqual({ bend: 0.8, depth: 0.4 });
    trail.setBend(0, 3, 0);
    expect(trail.at(0, 3)).toEqual({ bend: 0, depth: 0.4 });
  });

  it("keeps tracks apart, since a bend belongs to one channel", () => {
    const trail = new ExpressionTrail();
    trail.setBend(0, 1, 1);
    expect(trail.at(1, 1)).toEqual(flat);
    expect(trail.touched(1)).toBe(false);
  });

  it("drops a trail that predates a restart rather than bending the new notes", () => {
    const trail = new ExpressionTrail();
    trail.setBend(0, 10, 1);
    trail.setBend(0, 0.5, 0);
    expect(trail.at(0, 10).bend).toBe(0);
  });

  it("still answers correctly once the wheel has been worked for a long time", () => {
    const trail = new ExpressionTrail();
    for (let step = 0; step < 2000; step += 1) {
      trail.setBend(0, step * 0.05, step % 2 === 0 ? 1 : -1);
    }
    const last = 1999 * 0.05;
    expect(trail.at(0, last).bend).toBe(-1);
    expect(trail.at(0, last - 0.05).bend).toBe(1);
    // Movement older than the kept trail reads flat. The trail outlasts the
    // roll's look ahead, so such a note left the screen long before.
    expect(trail.at(0, 0)).toEqual(flat);
  });
});
