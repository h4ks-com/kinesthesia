import { describe, expect, it } from "vitest";
import { makeRock, struckBy } from "@/lib/skins/rubble";
import type { Traveller } from "@/lib/skins/types";

function noteAt(x: number, y: number): Traveller {
  return { x, y, radius: 10, color: "#ffffff" };
}

describe("reaching a rock", () => {
  it("breaks one a note has climbed into", () => {
    const rock = makeRock(200, 300, 20);
    expect(struckBy(rock, [noteAt(205, 295)])).not.toBeNull();
  });

  it("leaves one no note is near", () => {
    const rock = makeRock(200, 300, 20);
    expect(struckBy(rock, [noteAt(600, 300), noteAt(200, 90)])).toBeNull();
  });

  it("spares one still above the view, so the break is never spent off-screen", () => {
    const rock = makeRock(200, -40, 20);
    expect(struckBy(rock, [noteAt(200, -40)])).toBeNull();
  });

  it("names the note that reached it, so the burst takes its colour", () => {
    const rock = makeRock(200, 300, 20);
    const near = noteAt(200, 300);
    expect(struckBy(rock, [noteAt(900, 300), near])).toBe(near);
  });
});
