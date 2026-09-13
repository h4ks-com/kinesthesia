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

describe("a trail that keeps everything", () => {
  it("still answers for movement made long ago", () => {
    // A parsed file hands over the whole song at once. Dropping the early part
    // would leave most of a three minute piece unbent.
    const trail = new ExpressionTrail({ keepAll: true });
    for (let step = 0; step < 500; step += 1) {
      trail.setBend(0, step * 0.4, step === 10 ? 1 : 0);
    }
    expect(trail.at(0, 4.1).bend).toBe(1);
  });

  it("keeps culling the live trail, which only has to outlast the screen", () => {
    const trail = new ExpressionTrail();
    for (let step = 0; step < 500; step += 1) {
      trail.setBend(0, step * 0.4, step === 10 ? 1 : 0);
    }
    expect(trail.at(0, 4.1).bend).toBe(0);
  });
});

describe("reading a span", () => {
  it("reports a wheel still off centre from before the note began", () => {
    const trail = new ExpressionTrail({ keepAll: true });
    trail.setBend(0, 1, 0.5);
    expect(trail.moves(0, 4, 5)).toBe(true);
  });

  it("reports movement inside the span", () => {
    const trail = new ExpressionTrail({ keepAll: true });
    trail.setBend(0, 4.5, 0.5);
    expect(trail.moves(0, 4, 5)).toBe(true);
  });

  it("stays quiet for a span the wheels sat still through", () => {
    const trail = new ExpressionTrail({ keepAll: true });
    trail.setBend(0, 1, 0.5);
    trail.setBend(0, 2, 0);
    trail.setBend(0, 9, 1);
    expect(trail.moves(0, 4, 5)).toBe(false);
  });

  it("ignores movement that lands after the span", () => {
    const trail = new ExpressionTrail({ keepAll: true });
    trail.setBend(0, 5.5, 1);
    expect(trail.moves(0, 4, 5)).toBe(false);
  });

  it("counts the far edge of the span but not the near one", () => {
    const opening = new ExpressionTrail({ keepAll: true });
    opening.setBend(0, 4, 1);
    // A movement exactly at the start is what the note opens on, so it is the
    // held value rather than something that happens during the note.
    expect(opening.between(0, 4, 5)).toEqual([]);

    const closing = new ExpressionTrail({ keepAll: true });
    closing.setBend(0, 5, 1);
    expect(closing.between(0, 4, 5)).toHaveLength(1);
  });

  it("hands back only the span, in order", () => {
    const trail = new ExpressionTrail({ keepAll: true });
    for (const at of [1, 4.2, 4.6, 4.9, 7]) {
      trail.setBend(0, at, 0.5);
    }
    expect(trail.between(0, 4, 5).map((sample) => sample.at)).toEqual([
      4.2, 4.6, 4.9,
    ]);
  });
});
