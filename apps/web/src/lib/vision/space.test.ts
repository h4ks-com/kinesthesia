import { keybedDepth, WHITE_KEY_COUNT } from "keybed";
import { describe, expect, it } from "vitest";
import type { Keybed, Point, Size } from "@/lib/vision/placement";
import {
  awayAt,
  keyBand,
  keyFace,
  noteBar,
  stageSpace,
} from "@/lib/vision/space";

const frame: Size = { width: 1280, height: 720 };
const board = { lowest: 36, highest: 96 };

/** A camera square over the keys: the keybed is a rectangle of its own shape,
 * and the player stands at the bottom of the picture. */
function overhead(): Keybed {
  const wide = 0.72;
  const deep =
    (wide * frame.width * (keybedDepth() / WHITE_KEY_COUNT)) / frame.height;
  const left = (1 - wide) / 2;
  const top = 0.5 - deep / 2;
  return {
    quad: [
      { x: left, y: top },
      { x: left + wide, y: top },
      { x: left + wide, y: top + deep },
      { x: left, y: top + deep },
    ],
    playerEdgeIsFirst: false,
  };
}

function near(a: Point, b: Point, within: number): void {
  expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(within);
}

describe("keyBand", () => {
  it("fills the keybed from the lowest key to the highest", () => {
    expect(keyBand(board.lowest, board).from).toBeCloseTo(0);
    expect(keyBand(board.highest, board).to).toBeCloseTo(1);
  });

  it("keeps a black key inside the whites it sits between", () => {
    const black = keyBand(37, board);
    expect(black.from).toBeGreaterThan(keyBand(36, board).from);
    expect(black.to).toBeLessThan(keyBand(38, board).to);
  });
});

describe("stageSpace", () => {
  it("puts the ends of the keys on the corners it was given", () => {
    const stage = stageSpace(overhead(), frame);
    expect(stage).not.toBeNull();
    if (stage === null) {
      return;
    }
    const quad = overhead().quad;
    const [back, backEnd, playerEnd, player] = quad;
    if (
      back === undefined ||
      backEnd === undefined ||
      playerEnd === undefined ||
      player === undefined
    ) {
      throw new Error("A keybed is four corners");
    }
    const pixels = (point: Point): Point => ({
      x: point.x * frame.width,
      y: point.y * frame.height,
    });
    near(stage.onKeys(0, 0) ?? { x: 0, y: 0 }, pixels(back), 2);
    near(stage.onKeys(1, 0) ?? { x: 0, y: 0 }, pixels(backEnd), 2);
    near(stage.onKeys(1, 1) ?? { x: 0, y: 0 }, pixels(playerEnd), 2);
    near(stage.onKeys(0, 1) ?? { x: 0, y: 0 }, pixels(player), 2);
  });

  it("starts the runway beyond the keys and carries it away from the player", () => {
    const stage = stageSpace(overhead(), frame);
    if (stage === null) {
      throw new Error("The keybed is a rectangle and has a pose");
    }
    const atKeys = stage.at(0.5, 0);
    const upRunway = stage.at(0.5, awayAt(1));
    const onKeys = stage.onKeys(0.5, 0);
    const player = stage.onKeys(0.5, 1);
    if (
      atKeys === null ||
      upRunway === null ||
      onKeys === null ||
      player === null
    ) {
      throw new Error("An overhead camera sees all of its own keybed");
    }
    expect(atKeys.y).toBeLessThan(onKeys.y);
    expect(upRunway.y).toBeLessThan(atKeys.y);
    expect(player.y).toBeGreaterThan(onKeys.y);
  });

  it("lands a note on the key it is played on", () => {
    const stage = stageSpace(overhead(), frame);
    if (stage === null) {
      throw new Error("The keybed is a rectangle and has a pose");
    }
    const low = noteBar(stage, board.lowest, board, 0, 0.2);
    const high = noteBar(stage, board.highest, board, 0, 0.2);
    const face = keyFace(stage, board.lowest, board);
    if (low === null || high === null || face === null) {
      throw new Error("Both ends of the board are in the picture");
    }
    expect(low[0].x).toBeLessThan(high[0].x);
    expect(Math.abs(low[0].x - face[0].x)).toBeLessThan(2);
  });
});
