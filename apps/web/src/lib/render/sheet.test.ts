import { describe, expect, it } from "vitest";
import { sceneRegions } from "@/lib/render/sheet";

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
