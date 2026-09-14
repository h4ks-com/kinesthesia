import { isBlack } from "keybed";
import { describe, expect, it } from "vitest";
import { type Picture, readBoard } from "@/lib/vision/board";
import type { Keybed, Size } from "@/lib/vision/placement";
import {
  keyBand,
  keysOf,
  type PitchRange,
  stageSpace,
} from "@/lib/vision/space";

const frame: Size = { width: 960, height: 540 };
const keys = { left: 0.08, right: 0.92, far: 0.3, near: 0.74 };

const overhead: Keybed = {
  quad: [
    { x: keys.left, y: keys.far },
    { x: keys.right, y: keys.far },
    { x: keys.right, y: keys.near },
    { x: keys.left, y: keys.near },
  ],
  playerEdgeIsFirst: false,
};

/** A keyboard painted flat on, which is the picture the camera would take of
 * one from straight above. */
function pictureOf(range: PitchRange): Picture {
  const data = new Uint8ClampedArray(frame.width * frame.height * 4);
  const left = keys.left * frame.width;
  const wide = (keys.right - keys.left) * frame.width;
  const far = keys.far * frame.height;
  const deep = (keys.near - keys.far) * frame.height;
  const black = keysOf(range)
    .filter(isBlack)
    .map((pitch) => keyBand(pitch, range));
  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      const along = (x - left) / wide;
      const across = (y - far) / deep;
      const inside = along >= 0 && along <= 1 && across >= 0 && across <= 1;
      const onBlack =
        inside &&
        across < 0.62 &&
        black.some((band) => along >= band.from && along < band.to);
      const level = inside ? (onBlack ? 28 : 226) : 90;
      const at = (y * frame.width + x) * 4;
      data[at] = level;
      data[at + 1] = level;
      data[at + 2] = level;
      data[at + 3] = 255;
    }
  }
  return { width: frame.width, height: frame.height, data, scale: 1 };
}

function read(
  range: PitchRange,
  played: PitchRange | null = null,
): PitchRange | string {
  const stage = stageSpace(overhead, frame);
  if (stage === null) {
    throw new Error("A rectangle of the right shape has a pose");
  }
  const found = readBoard(stage, pictureOf(range), played);
  return found.kind === "read" ? found.range : found.reason;
}

describe("readBoard", () => {
  it("reads a five octave board off its black keys", () => {
    expect(read({ lowest: 36, highest: 96 })).toEqual({
      lowest: 36,
      highest: 96,
    });
  });

  it("counts the keys rather than assuming them", () => {
    expect(read({ lowest: 28, highest: 103 })).toEqual({
      lowest: 28,
      highest: 103,
    });
  });

  it("takes the octave from the notes the player has sounded", () => {
    const high = { lowest: 48, highest: 108 };
    expect(read(high)).not.toEqual(high);
    expect(read(high, { lowest: 108, highest: 108 })).toEqual(high);
  });

  it("says so when the picture holds no keyboard", () => {
    const stage = stageSpace(overhead, frame);
    if (stage === null) {
      throw new Error("A rectangle of the right shape has a pose");
    }
    const blank: Picture = {
      width: frame.width,
      height: frame.height,
      data: new Uint8ClampedArray(frame.width * frame.height * 4).fill(200),
      scale: 1,
    };
    expect(readBoard(stage, blank).kind).toBe("unsure");
  });
});
