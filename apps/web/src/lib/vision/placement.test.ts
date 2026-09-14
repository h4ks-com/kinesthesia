import { describe, expect, it } from "vitest";
import {
  type Keybed,
  keybedAngle,
  placeKeybed,
  placePoint,
  playerEdge,
} from "@/lib/vision/placement";

const frame = { width: 1280, height: 720 };
const output = { width: 1920, height: 1080 };

/** A keybed lying flat across the middle of the frame, player side nearest the
 * bottom. */
function flat(): Keybed {
  return {
    quad: [
      { x: 240, y: 300 },
      { x: 1040, y: 300 },
      { x: 1040, y: 420 },
      { x: 240, y: 420 },
    ],
    playerEdgeIsFirst: false,
  };
}

/** The same keybed seen from a camera rolled a quarter turn. */
function turned(degrees: number): Keybed {
  const radians = (degrees * Math.PI) / 180;
  const centre = { x: frame.width / 2, y: frame.height / 2 };
  return {
    quad: flat().quad.map((corner) => ({
      x:
        centre.x +
        (corner.x - centre.x) * Math.cos(radians) -
        (corner.y - centre.y) * Math.sin(radians),
      y:
        centre.y +
        (corner.x - centre.x) * Math.sin(radians) +
        (corner.y - centre.y) * Math.cos(radians),
    })),
    playerEdgeIsFirst: false,
  };
}

describe("reading the keybed's angle", () => {
  it("reads a keybed lying flat as level", () => {
    expect(keybedAngle(flat())).toBeCloseTo(0, 6);
  });

  it("reads the camera's roll off the keys", () => {
    expect((keybedAngle(turned(30)) * 180) / Math.PI).toBeCloseTo(30, 4);
    expect((keybedAngle(turned(-115)) * 180) / Math.PI).toBeCloseTo(-115, 4);
  });

  it("takes the edge the player stands at, not the far one", () => {
    const [from, to] = playerEdge(flat());
    expect([from.y, to.y]).toEqual([420, 420]);
    const far = playerEdge({ ...flat(), playerEdgeIsFirst: true });
    expect([far[0].y, far[1].y]).toEqual([300, 300]);
  });
});

describe("laying the keys along the bottom", () => {
  it("puts the keys level, centred and near the bottom", () => {
    const placement = placeKeybed(turned(37), frame, output);
    const [from, to] = playerEdge(turned(37));
    const left = placePoint(from, placement, frame);
    const right = placePoint(to, placement, frame);

    expect(left.y).toBeCloseTo(right.y, 4);
    expect(left.y).toBeCloseTo(output.height * 0.96, 4);
    expect((left.x + right.x) / 2).toBeCloseTo(output.width / 2, 4);
  });

  it("spans the width it was asked for, whatever the camera's roll", () => {
    for (const degrees of [0, 12, -48, 90, 171]) {
      const keybed = turned(degrees);
      const placement = placeKeybed(keybed, frame, output);
      const [from, to] = playerEdge(keybed);
      const left = placePoint(from, placement, frame);
      const right = placePoint(to, placement, frame);
      expect(Math.abs(right.x - left.x)).toBeCloseTo(output.width * 0.9, 3);
    }
  });

  it("keeps the far edge of the keys above the near one", () => {
    const keybed = turned(-20);
    const placement = placeKeybed(keybed, frame, output);
    const near = placePoint(keybed.quad[3] ?? { x: 0, y: 0 }, placement, frame);
    const far = placePoint(keybed.quad[0] ?? { x: 0, y: 0 }, placement, frame);
    expect(far.y).toBeLessThan(near.y);
  });

  it("fills more of the width when asked", () => {
    const wide = placeKeybed(flat(), frame, output, {
      fill: 1,
      margin: 0.04,
    });
    const narrow = placeKeybed(flat(), frame, output, {
      fill: 0.5,
      margin: 0.04,
    });
    expect(wide.scale).toBeGreaterThan(narrow.scale);
  });
});
