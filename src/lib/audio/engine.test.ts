import { describe, expect, it } from "vitest";
import { adaptedVoiceLimit } from "@/lib/audio/engine";

describe("adaptedVoiceLimit", () => {
  it("climbs when on time and pressing against the ceiling", () => {
    expect(adaptedVoiceLimit(96, 25, 96)).toBe(104);
  });

  it("holds when on time but nowhere near the ceiling", () => {
    expect(adaptedVoiceLimit(96, 25, 10)).toBe(96);
  });

  it("backs off hard when a tick lands late", () => {
    expect(adaptedVoiceLimit(200, 90, 200)).toBe(140);
  });

  it("backs off even when few voices sound, since a late tick is the machine behind", () => {
    expect(adaptedVoiceLimit(200, 90, 0)).toBe(140);
  });

  it("holds steady in the band between", () => {
    expect(adaptedVoiceLimit(200, 40, 200)).toBe(200);
  });

  it("never climbs past the ceiling", () => {
    expect(adaptedVoiceLimit(256, 25, 256)).toBe(256);
  });

  it("never falls below the floor", () => {
    expect(adaptedVoiceLimit(48, 200, 48)).toBe(48);
  });
});
