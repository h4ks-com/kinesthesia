"use client";

import type { Point } from "@/lib/vision/placement";

/** The picture is sampled this coarsely to ask whether anything moved. A camera
 * that has been nudged moves every one of these; a hand over the keys moves a
 * few, and those are inside the keybed and not asked. */
const across = 48;
const down = 27;

/** How far the average sample may drift, in levels out of 255, before the
 * picture counts as a different one. Sensor noise in a dim room runs to a level
 * or two. */
const movedBy = 6;

export type Stillness = {
  /** Whether the picture outside the keybed changed since it was last asked. */
  readonly changed: (
    frame: CanvasImageSource,
    keybed: readonly Point[] | null,
  ) => boolean;
  readonly forget: () => void;
};

function inside(quad: readonly Point[], at: Point): boolean {
  let within = false;
  for (let index = 0; index < quad.length; index += 1) {
    const one = quad[index];
    const other = quad[(index + quad.length - 1) % quad.length];
    if (one === undefined || other === undefined) {
      return false;
    }
    if (
      one.y > at.y !== other.y > at.y &&
      at.x < ((other.x - one.x) * (at.y - one.y)) / (other.y - one.y) + one.x
    ) {
      within = !within;
    }
  }
  return within;
}

/** Whether the camera is looking at the same scene it was. The instrument does
 * not move while it is played, so the model only has to run again once the
 * picture around it does. */
export function createStillness(): Stillness {
  const sheet = document.createElement("canvas");
  sheet.width = across;
  sheet.height = down;
  let last: Uint8ClampedArray | null = null;

  return {
    changed: (frame, keybed) => {
      const context = sheet.getContext("2d", { willReadFrequently: true });
      if (context === null) {
        return true;
      }
      context.drawImage(frame, 0, 0, across, down);
      const now = context.getImageData(0, 0, across, down).data;
      const before = last;
      last = now;
      if (before === null || before.length !== now.length) {
        return true;
      }
      let drift = 0;
      let counted = 0;
      for (let y = 0; y < down; y += 1) {
        for (let x = 0; x < across; x += 1) {
          const at = { x: (x + 0.5) / across, y: (y + 0.5) / down };
          if (keybed !== null && inside(keybed, at)) {
            continue;
          }
          const index = (y * across + x) * 4;
          drift += Math.abs((now[index] ?? 0) - (before[index] ?? 0));
          counted += 1;
        }
      }
      return counted === 0 || drift / counted > movedBy;
    },
    forget: () => {
      last = null;
    },
  };
}
