import { describe, expect, it } from "vitest";
import {
  leadCell,
  leadFloor,
  leadShare,
  solid,
  tossUp,
} from "@/lib/scoring/lead";

describe("leadShare", () => {
  it("is nothing before either side has scored", () => {
    expect(leadShare(0, 0)).toBe(0);
  });

  it("is nothing while the two are level", () => {
    expect(leadShare(3000, 3000)).toBe(0);
  });

  it("is positive when you are ahead and negative when they are", () => {
    expect(leadShare(2000, 1000)).toBeGreaterThan(0);
    expect(leadShare(1000, 2000)).toBeLessThan(0);
  });

  it("reads the same gap as smaller once more has been scored", () => {
    expect(leadShare(900, 600)).toBeGreaterThan(leadShare(5300, 5000));
  });

  it("holds an early lead back until there is a board to judge it against", () => {
    expect(leadShare(100, 0)).toBeCloseTo(100 / leadFloor, 6);
  });

  it("never passes the ends, however lopsided", () => {
    expect(leadShare(90_000, 0)).toBe(1);
    expect(leadShare(0, 90_000)).toBe(-1);
  });
});

describe("leadCell", () => {
  it("lights the middle while the match is too close to call", () => {
    expect(leadCell(0)).toBe(2);
    expect(leadCell(tossUp - 0.01)).toBe(2);
    expect(leadCell(-tossUp + 0.01)).toBe(2);
  });

  it("walks toward your end as you pull ahead", () => {
    expect(leadCell(tossUp)).toBe(1);
    expect(leadCell(solid)).toBe(0);
  });

  it("walks toward theirs as you fall behind", () => {
    expect(leadCell(-tossUp)).toBe(3);
    expect(leadCell(-solid)).toBe(4);
  });

  it("stays inside the meter at both ends", () => {
    expect(leadCell(1)).toBe(0);
    expect(leadCell(-1)).toBe(4);
  });

  it("puts the same margin the same distance from the middle either way", () => {
    for (const share of [0.1, 0.2, 0.5, 0.9]) {
      expect(leadCell(share) + leadCell(-share)).toBe(4);
    }
  });
});
