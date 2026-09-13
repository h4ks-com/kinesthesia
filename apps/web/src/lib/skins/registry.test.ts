import { describe, expect, it } from "vitest";
import {
  directionFor,
  findSkin,
  offeredSkins,
  skins,
  skinsFor,
  suitsDirection,
} from "@/lib/skins/registry";
import { skinIds } from "@/lib/skins/types";

/** Real skins, because a hand-built one would carry directions the table no
 * longer takes its answer from. */
const flying = findSkin("cruise");
const grounded = findSkin("horizon");

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
    expect(flying).not.toBeNull();
    expect(flying === null || suitsDirection(flying, "up")).toBe(true);
    expect(flying !== null && suitsDirection(flying, "down")).toBe(false);
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

  it("offers every background in watch and only the falling ones elsewhere", () => {
    expect(offeredSkins(true)).toEqual(skins);
    for (const skin of offeredSkins(false)) {
      expect(suitsDirection(skin, "down")).toBe(true);
    }
    expect(offeredSkins(false).length).toBeGreaterThan(0);
  });

  it("keeps them falling on the plain roll", () => {
    expect(directionFor(null, true)).toBe("down");
  });

  it("keeps them falling under a background that only reads that way", () => {
    expect(directionFor(grounded, true)).toBe("down");
  });
});
