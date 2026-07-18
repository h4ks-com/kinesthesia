import { describe, expect, it } from "vitest";
import {
  clampLatency,
  judgedPosition,
  latencyAdvice,
  latencyRange,
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

describe("latencyAdvice", () => {
  it("stays quiet when the output is quick", () => {
    expect(latencyAdvice(0.04)).toBeNull();
  });

  it("calls out a slow output device", () => {
    const advice = latencyAdvice(0.2);
    expect(advice).toContain("200ms");
    expect(advice).toContain("wired");
  });
});
