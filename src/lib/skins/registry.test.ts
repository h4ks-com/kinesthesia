import { describe, expect, it } from "vitest";
import {
  findSkin,
  noSkin,
  skins,
  skinsFor,
  suitsDirection,
} from "@/lib/skins/registry";
import type { Skin } from "@/lib/skins/types";

const flying: Skin = {
  id: "flying",
  name: "Flying",
  blurb: "Only reads while notes leave the keys.",
  directions: ["up"],
  create: () => null,
};

describe("the skin registry", () => {
  it("gives every skin its own id, since that is what is stored", () => {
    const ids = new Set(skins.map((skin) => skin.id));
    expect(ids.size).toBe(skins.length);
  });

  it("never claims the plain roll as a skin, so choosing it mounts nothing", () => {
    expect(findSkin(noSkin)).toBeNull();
  });

  it("finds nothing for an id that is no longer shipped", () => {
    expect(findSkin("retired-skin")).toBeNull();
  });

  it("offers a skin only where it reads the right way round", () => {
    expect(suitsDirection(flying, "up")).toBe(true);
    expect(suitsDirection(flying, "down")).toBe(false);
  });

  it("keeps every shipped skin describable, since the picker shows it", () => {
    for (const skin of skins) {
      expect(skin.name.length).toBeGreaterThan(0);
      expect(skin.blurb.length).toBeGreaterThan(0);
      expect(skin.directions.length).toBeGreaterThan(0);
    }
  });

  it("has something to offer free roam, where notes leave the keys", () => {
    expect(skinsFor("up").length).toBeGreaterThan(0);
  });
});
