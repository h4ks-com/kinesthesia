import { describe, expect, it } from "vitest";
import { playerModes } from "@/lib/player-url";
import { tourFor } from "@/lib/tour/steps";

describe("tourFor", () => {
  it("has a tour for every mode", () => {
    for (const mode of playerModes) {
      expect(tourFor(mode).length).toBeGreaterThan(0);
    }
  });

  it("opens each mode where its work starts", () => {
    expect(tourFor("watch")[0]?.anchor).toBe("track-list");
    expect(tourFor("learn")[0]?.anchor).toBe("track-list");
    expect(tourFor("multiplayer")[0]?.anchor).toBe("opponent");
  });

  it("holds the tracks popover open for the steps that point inside it", () => {
    const inside = tourFor("learn").filter((step) => step.open === "tracks");
    expect(inside.map((step) => step.anchor)).toEqual([
      "track-list",
      "track-claim",
      "track-sound",
    ]);
  });

  it("only points at anchors that carry a title and a body", () => {
    for (const mode of playerModes) {
      for (const step of tourFor(mode)) {
        expect(step.anchor).not.toBe("");
        expect(step.title).not.toBe("");
        expect(step.body).not.toBe("");
      }
    }
  });
});
