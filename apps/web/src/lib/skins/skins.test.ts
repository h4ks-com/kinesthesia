import { describe, expect, it } from "vitest";
import { skins } from "@/lib/skins/registry";

/** jsdom has no canvas context, which is the same answer a device that cannot
 * run one gives. Every skin has to take that as an answer rather than leaving a
 * blank layer over the roll. */
describe("every shipped background", () => {
  for (const skin of skins) {
    describe(skin.name, () => {
      it("says it cannot run rather than leaving a blank layer", () => {
        expect(
          skin.create({
            base: document.createElement("canvas"),
            overlay: document.createElement("canvas"),
          }),
        ).toBeNull();
      });

      it("only claims directions the roll knows about", () => {
        expect(skin.directions.length).toBeGreaterThan(0);
        for (const direction of skin.directions) {
          expect(["up", "down"]).toContain(direction);
        }
      });

      it("tells the player what it does before they pick it", () => {
        expect(skin.blurb.length).toBeGreaterThan(20);
        expect(skin.blurb.endsWith(".")).toBe(true);
      });
    });
  }

  it("offers something whichever way the notes travel", () => {
    for (const direction of ["up", "down"] as const) {
      expect(
        skins.filter((skin) => skin.directions.includes(direction)).length,
      ).toBeGreaterThan(0);
    }
  });
});
