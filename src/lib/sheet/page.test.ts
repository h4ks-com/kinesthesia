import { describe, expect, test } from "vitest";
import { dragScroll, pageWidth } from "@/lib/sheet/page";

describe("pageWidth", () => {
  test("keeps the panel's own width when it is already wide enough", () => {
    expect(pageWidth(1600, 1200)).toBe(1600);
  });

  test("floors a narrower panel to the minimum", () => {
    expect(pageWidth(390, 1200)).toBe(1200);
  });

  test("holds exactly at the minimum", () => {
    expect(pageWidth(1200, 1200)).toBe(1200);
  });
});

describe("dragScroll", () => {
  test("moves the scroll opposite the pointer's travel", () => {
    expect(dragScroll(100, 500, 460, 1000)).toBe(140);
    expect(dragScroll(100, 500, 540, 1000)).toBe(60);
  });

  test("clamps to zero", () => {
    expect(dragScroll(50, 500, 800, 1000)).toBe(0);
  });

  test("clamps to the max", () => {
    expect(dragScroll(900, 500, 100, 1000)).toBe(1000);
  });
});
