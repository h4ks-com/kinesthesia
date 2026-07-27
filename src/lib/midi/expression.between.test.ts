import { describe, expect, it } from "vitest";
import { ExpressionTrail } from "@/lib/midi/expression";

/** Each call is one wheel moving once, which is how a file writes them. */
function trail(): ExpressionTrail {
  const written = new ExpressionTrail({ keepAll: true });
  written.setBend(0, 1, 0);
  written.setBend(0, 2, 0.5);
  written.setBend(0, 3, 1);
  written.setDepth(0, 4, 0.4);
  written.setBend(0, 8, 0);
  return written;
}

describe("reading the wheels across a note", () => {
  it("hands back every move inside the note, in order", () => {
    expect(
      trail()
        .between(0, 1.5, 4.5)
        .map((sample) => sample.at),
    ).toEqual([2, 3, 4]);
  });

  it("leaves out what happens before and after it", () => {
    expect(trail().between(0, 5, 7)).toHaveLength(0);
  });

  it("takes the far edge and not the near one, so a note owns its own start", () => {
    expect(
      trail()
        .between(0, 2, 3)
        .map((sample) => sample.at),
    ).toEqual([3]);
  });

  it("carries the values, not just the times", () => {
    const [first] = trail().between(0, 3.5, 4.5);
    expect(first?.depth).toBe(0.4);
    // The wheel it did not touch keeps whatever it was left at.
    expect(first?.bend).toBe(1);
  });

  it("says nothing for a track that never moved", () => {
    expect(trail().between(9, 0, 100)).toHaveLength(0);
  });
});
