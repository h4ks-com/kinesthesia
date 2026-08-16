import { describe, expect, it } from "vitest";
import {
  easedScroll,
  sceneRegions,
  sheetScrollTarget,
} from "@/lib/render/sheet";

describe("sceneRegions", () => {
  it("gives the whole frame to the notes when the notation is off", () => {
    const { sheet, roll } = sceneRegions("off", 1280, 720);
    expect(sheet).toBeNull();
    expect(roll).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
  });

  it("gives the whole frame to the notation on its own", () => {
    const { sheet, roll } = sceneRegions("full", 1280, 720);
    expect(roll).toBeNull();
    expect(sheet).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
  });

  it("stacks the notation above the notes, each keeping the whole width", () => {
    const { sheet, roll } = sceneRegions("half", 1280, 720);
    expect(sheet).toEqual({ x: 0, y: 0, width: 1280, height: 360 });
    expect(roll).toEqual({ x: 0, y: 360, width: 1280, height: 360 });
  });

  it("tiles an odd height exactly, so no row of the frame is left unpainted", () => {
    const { sheet, roll } = sceneRegions("half", 1280, 721);
    expect(sheet?.height ?? 0).toBeGreaterThan(0);
    expect((sheet?.height ?? 0) + (roll?.height ?? 0)).toBe(721);
    expect(roll?.y).toBe(sheet?.height);
  });
});

describe("sheetScrollTarget", () => {
  it("settles the current system a third of the way down", () => {
    expect(sheetScrollTarget(600, 300, 4000)).toBe(500);
  });

  it("holds at the top rather than scrolling above the first system", () => {
    expect(sheetScrollTarget(40, 300, 4000)).toBe(0);
  });

  it("stops at the last system rather than scrolling past the end", () => {
    expect(sheetScrollTarget(3900, 300, 4000)).toBe(3700);
  });

  it("stays at the top for a score shorter than the panel", () => {
    expect(sheetScrollTarget(180, 300, 200)).toBe(0);
  });
});

describe("easedScroll", () => {
  it("moves toward the target without overshooting it", () => {
    const stepped = easedScroll(0, 1000, 1000 / 30);
    expect(stepped).toBeGreaterThan(0);
    expect(stepped).toBeLessThan(1000);
  });

  it("covers more ground in a longer frame", () => {
    expect(easedScroll(0, 1000, 1000 / 30)).toBeLessThan(
      easedScroll(0, 1000, 1000 / 15),
    );
  });

  it("rests once it is there", () => {
    expect(easedScroll(500, 500, 1000 / 30)).toBe(500);
  });

  it("is all but there a second later, however far the jump was", () => {
    let scroll = 0;
    for (let frame = 0; frame < 60; frame += 1) {
      scroll = easedScroll(scroll, 800, 1000 / 60);
    }
    expect(scroll).toBeGreaterThan(760);
    expect(scroll).toBeLessThan(800);
  });
});
