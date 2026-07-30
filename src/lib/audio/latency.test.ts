import { describe, expect, it } from "vitest";
import {
  clampLatency,
  judgedPosition,
  latencyRange,
  suggestedOffset,
} from "@/lib/audio/latency";

describe("clampLatency", () => {
  it("keeps sane offsets untouched", () => {
    expect(clampLatency(40)).toBe(40);
    expect(clampLatency(-20)).toBe(-20);
  });

  it("refuses absurd offsets", () => {
    expect(clampLatency(9000)).toBe(latencyRange.max);
    expect(clampLatency(-9000)).toBe(latencyRange.min);
  });

  it("works in whole milliseconds", () => {
    expect(clampLatency(12.6)).toBe(13);
  });
});

describe("judgedPosition", () => {
  it("is the plain position when nothing lags", () => {
    expect(judgedPosition(10, 1000, 1000, 0, 0)).toBe(10);
  });

  it("rewinds by the output latency", () => {
    expect(judgedPosition(10, 1000, 1000, 0.02, 0)).toBeCloseTo(9.98);
  });

  it("rewinds by the time spent getting to the handler", () => {
    expect(judgedPosition(10, 1000, 1030, 0, 0)).toBeCloseTo(9.97);
  });

  it("applies a manual offset on top", () => {
    expect(judgedPosition(10, 1000, 1000, 0, 50)).toBeCloseTo(9.95);
  });

  it("lets a negative offset push the other way", () => {
    expect(judgedPosition(10, 1000, 1000, 0, -50)).toBeCloseTo(10.05);
  });

  it("never goes before the start of the song", () => {
    expect(judgedPosition(0.01, 1000, 1000, 0.5, 0)).toBe(0);
  });
});

describe("suggestedOffset", () => {
  const late = (count: number, seconds: number): number[] =>
    Array.from({ length: count }, () => seconds);

  it("says nothing until enough hits have been timed", () => {
    expect(suggestedOffset(late(11, 0.2), 0)).toBeNull();
  });

  it("says nothing when the drift is within human wobble", () => {
    expect(suggestedOffset(late(20, 0.02), 0)).toBeNull();
  });

  it("offers the offset that would cancel a consistent late drift", () => {
    expect(suggestedOffset(late(20, 0.18), 0)).toBe(180);
  });

  it("adds to the offset already set, since the drift is what remains", () => {
    expect(suggestedOffset(late(20, 0.05), 100)).toBe(150);
  });

  it("reads the middle hit, so one wild press decides nothing", () => {
    const deltas = [...late(19, 0.002), 5];
    expect(suggestedOffset(deltas, 0)).toBeNull();
  });

  it("pulls back for a player who keeps landing early", () => {
    expect(suggestedOffset(late(20, -0.09), 40)).toBe(-50);
  });

  it("stays inside what the slider can hold", () => {
    expect(suggestedOffset(late(20, 5), 0)).toBe(latencyRange.max);
  });
});
