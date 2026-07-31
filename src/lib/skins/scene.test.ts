import { describe, expect, it } from "vitest";
import { defineSkin, moodOf, type SceneView } from "@/lib/skins/scene";
import type { SkinFrame, Traveller } from "@/lib/skins/types";
import { skinDirections } from "@/lib/skins/types";

const view: SceneView = { width: 100, height: 200, keyboardTop: 160 };

function at(x: number): Traveller {
  return { x, y: 10, radius: 5, color: "#fff" };
}

function frame(over: Partial<SkinFrame> = {}): SkinFrame {
  return {
    keyboardTop: 160,
    elapsed: 1,
    position: 0,
    travellers: [],
    strikes: [],
    ...over,
  };
}

describe("reading the mood of a frame", () => {
  it("sits in the middle when nothing is playing", () => {
    expect(moodOf(frame(), view)).toEqual({ tone: 0.5, energy: 0 });
  });

  it("leans low for the bass end and high for the top", () => {
    expect(moodOf(frame({ travellers: [at(10)] }), view).tone).toBeCloseTo(0.1);
    expect(moodOf(frame({ travellers: [at(90)] }), view).tone).toBeCloseTo(0.9);
  });

  it("falls back to what landed, since a falling song has no travellers", () => {
    const landed = frame({ strikes: [{ x: 80, color: "#fff" }] });
    expect(moodOf(landed, view).tone).toBeCloseTo(0.8);
    expect(moodOf(landed, view).energy).toBeGreaterThan(0);
  });

  it("grows with how much is sounding, and stops at full", () => {
    const few = moodOf(frame({ travellers: [at(50), at(50)] }), view).energy;
    const many = moodOf(
      frame({ travellers: Array.from({ length: 20 }, () => at(50)) }),
      view,
    ).energy;
    expect(many).toBeGreaterThan(few);
    expect(many).toBe(1);
  });

  it("stays inside its range whatever the roll reports", () => {
    const { tone } = moodOf(frame({ travellers: [at(-400), at(900)] }), view);
    expect(tone).toBeGreaterThanOrEqual(0);
    expect(tone).toBeLessThanOrEqual(1);
  });
});

describe("defining a skin", () => {
  const spec = {
    id: "ink",
    name: "Test",
    blurb: "A background for a test.",
    createScene: () => ({}),
  } as const;

  it("carries its own description through, so the picker can show it", () => {
    const skin = defineSkin({ ...spec });
    expect(skin.id).toBe("ink");
    expect(skin.name).toBe("Test");
  });

  it("takes its directions from the one table, not from the skin", () => {
    expect(defineSkin({ ...spec }).directions).toEqual(skinDirections.ink);
  });

  /** jsdom has no canvas context, which is the same answer a device that cannot
   * run one gives. */
  it("says it cannot run rather than leaving a blank layer", () => {
    const skin = defineSkin({ ...spec });
    expect(
      skin.create({
        base: document.createElement("canvas"),
        overlay: document.createElement("canvas"),
      }),
    ).toBeNull();
  });
});
