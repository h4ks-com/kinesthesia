import { describe, expect, it } from "vitest";
import {
  directionFor,
  findSkin,
  skins,
  skinsFor,
  suitsDirection,
} from "@/lib/skins/registry";
import type { Skin } from "@/lib/skins/types";
import { skinIds } from "@/lib/skins/types";

const flying: Skin = {
  id: "cruise",
  name: "Flying",
  blurb: "Only reads while notes leave the keys.",
  directions: ["up"],
  create: () => null,
};

const grounded: Skin = { ...flying, directions: ["down"] };

describe("the skin registry", () => {
  it("ships one skin per declared id, since a link may name any of them", () => {
    expect(skins.map((skin) => skin.id)).toEqual([...skinIds]);
  });

  it("finds nothing for the plain roll, so choosing it mounts nothing", () => {
    expect(findSkin(null)).toBeNull();
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

describe("which way the notes travel", () => {
  it("sends them out of the keys under a background built to be flown", () => {
    expect(directionFor(flying, true)).toBe("up");
  });

  it("keeps them falling where they have to be read coming", () => {
    expect(directionFor(flying, false)).toBe("down");
  });

  it("keeps them falling on the plain roll", () => {
    expect(directionFor(null, true)).toBe("down");
  });

  it("keeps them falling under a background that only reads that way", () => {
    expect(directionFor(grounded, true)).toBe("down");
  });
});
