import { describe, expect, it } from "vitest";
import { cruise } from "@/lib/skins/cruise";
import { starfield } from "@/lib/skins/starfield";

/** jsdom has no WebGL, which is the same answer a device without it gives. */
describe("the deep space skin", () => {
  it("says it cannot run rather than leaving a blank layer", () => {
    expect(
      starfield.create({
        base: document.createElement("canvas"),
        overlay: document.createElement("canvas"),
      }),
    ).toBeNull();
  });

  it("is offered only where notes leave the keys", () => {
    expect(starfield.directions).toEqual(["up"]);
  });

  it("tells the player what it does before they pick it", () => {
    expect(starfield.blurb).toMatch(/asteroid/i);
  });
});

describe("the cruising skin", () => {
  it("says it cannot run rather than leaving a blank layer", () => {
    expect(
      cruise.create({
        base: document.createElement("canvas"),
        overlay: document.createElement("canvas"),
      }),
    ).toBeNull();
  });

  it("is offered only where notes leave the keys, since it is flown through", () => {
    expect(cruise.directions).toEqual(["up"]);
  });
});
