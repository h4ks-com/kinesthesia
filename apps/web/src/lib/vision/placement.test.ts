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
      { x: 240 / frame.width, y: 300 / frame.height },
      { x: 1040 / frame.width, y: 300 / frame.height },
      { x: 1040 / frame.width, y: 420 / frame.height },
      { x: 240 / frame.width, y: 420 / frame.height },
    ],
    playerEdgeIsFirst: false,
  };
}

/** The same keybed seen from a camera rolled a quarter turn. */
function turned(degrees: number): Keybed {
  const radians = (degrees * Math.PI) / 180;
  const centre = { x: frame.width / 2, y: frame.height / 2 };
  return {
    quad: flat().quad.map((corner) => {
      const at = { x: corner.x * frame.width, y: corner.y * frame.height };
      const turnedPoint = {
        x:
          centre.x +
          (at.x - centre.x) * Math.cos(radians) -
          (at.y - centre.y) * Math.sin(radians),
        y:
          centre.y +
          (at.x - centre.x) * Math.sin(radians) +
          (at.y - centre.y) * Math.cos(radians),
      };
      return {
        x: turnedPoint.x / frame.width,
        y: turnedPoint.y / frame.height,
      };
    }),
    playerEdgeIsFirst: false,
  };
}

describe("reading the keybed's angle", () => {
  it("reads a keybed lying flat as level", () => {
    expect(keybedAngle(flat(), frame)).toBeCloseTo(0, 6);
  });

  it("reads the camera's roll off the keys", () => {
    expect((keybedAngle(turned(30), frame) * 180) / Math.PI).toBeCloseTo(30, 4);
    expect((keybedAngle(turned(-115), frame) * 180) / Math.PI).toBeCloseTo(
      -115,
      4,
    );
  });

  it("takes the edge the player stands at, not the far one", () => {
    const [from, to] = playerEdge(flat(), frame);
    expect([from.y, to.y]).toEqual([420, 420]);
    const far = playerEdge({ ...flat(), playerEdgeIsFirst: true }, frame);
    expect([far[0].y, far[1].y]).toEqual([300, 300]);
  });
});

describe("laying the keys along the bottom", () => {
  it("puts the keys level, centred and near the bottom", () => {
    const placement = placeKeybed(turned(37), frame, output);
    const [from, to] = playerEdge(turned(37), frame);
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
      const [from, to] = playerEdge(keybed, frame);
      const left = placePoint(from, placement, frame);
      const right = placePoint(to, placement, frame);
      expect(Math.abs(right.x - left.x)).toBeCloseTo(output.width * 0.9, 3);
    }
  });

  it("keeps the far edge of the keys above the near one", () => {
    const keybed = turned(-20);
    const placement = placeKeybed(keybed, frame, output);
    const asPixel = (corner: { x: number; y: number } | undefined) => ({
      x: (corner?.x ?? 0) * frame.width,
      y: (corner?.y ?? 0) * frame.height,
    });
    const near = placePoint(asPixel(keybed.quad[3]), placement, frame);
    const far = placePoint(asPixel(keybed.quad[0]), placement, frame);
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
