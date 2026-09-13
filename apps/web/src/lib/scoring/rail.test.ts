import { describe, expect, it } from "vitest";
import { goodWindow, lateWindow, perfectWindow } from "@/lib/scoring/judge";
import {
  enoughForHabit,
  goodBand,
  perfectBand,
  railMean,
  railPlace,
  railSpan,
} from "@/lib/scoring/rail";

describe("railPlace", () => {
  it("puts a strike on the beat in the middle", () => {
    expect(railPlace(0)).toBe(0.5);
  });

  it("puts early before the middle and late after it", () => {
    expect(railPlace(-0.05)).toBeLessThan(0.5);
    expect(railPlace(0.05)).toBeGreaterThan(0.5);
  });

  it("places early and late the same distance out", () => {
    expect(railPlace(-0.08) - 0).toBeCloseTo(1 - railPlace(0.08), 10);
  });

  it("reaches the ends exactly at the furthest a strike can be judged", () => {
    expect(railPlace(-railSpan)).toBe(0);
    expect(railPlace(railSpan)).toBe(1);
  });

  it("holds anything beyond that at the ends rather than off the rail", () => {
    expect(railPlace(-railSpan * 4)).toBe(0);
    expect(railPlace(railSpan * 4)).toBe(1);
  });

  // The rail is only worth reading if the bands agree with the verdicts.
  it("keeps every judged strike inside the rail", () => {
    expect(railPlace(lateWindow)).toBeLessThanOrEqual(1);
    expect(railPlace(-lateWindow)).toBeGreaterThanOrEqual(0);
  });
});

describe("bands", () => {
  it("sizes each band to the window it stands for", () => {
    expect(perfectBand).toBeCloseTo(perfectWindow / railSpan, 10);
    expect(goodBand).toBeCloseTo(goodWindow / railSpan, 10);
  });

  it("nests perfect inside good inside the rail", () => {
    expect(perfectBand).toBeLessThan(goodBand);
    expect(goodBand).toBeLessThanOrEqual(1);
  });

  it("lands a strike at the edge of a window on the edge of its band", () => {
    const edge = (1 - perfectBand) / 2;
    expect(railPlace(-perfectWindow)).toBeCloseTo(edge, 10);
    expect(railPlace(perfectWindow)).toBeCloseTo(1 - edge, 10);
  });
});

describe("railMean", () => {
  it("says nothing until there are enough strikes to read a habit from", () => {
    const few = Array.from({ length: enoughForHabit - 1 }, () => 0.05);
    expect(railMean(few)).toBeNull();
    expect(railMean([])).toBeNull();
  });

  it("averages once there are", () => {
    const enough = Array.from({ length: enoughForHabit }, () => 0.04);
    expect(railMean(enough)).toBeCloseTo(0.04, 10);
  });

  it("cancels a player who is as often early as late", () => {
    expect(railMean([-0.1, 0.1, -0.06, 0.06])).toBeCloseTo(0, 10);
  });

  it("leans early for a player who rushes", () => {
    const rushing = railMean([-0.04, -0.05, -0.03, -0.06]);
    expect(rushing).not.toBeNull();
    expect(rushing ?? 0).toBeLessThan(0);
  });
});
