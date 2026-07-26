import { createFullscreen, nebulaSource } from "@/lib/skins/fullscreen";
import { RockField } from "@/lib/skins/rubble";
import type {
  Skin,
  SkinFrame,
  SkinInstance,
  SkinSurface,
} from "@/lib/skins/types";

/** Kept well under the roll's own brightness, so a note always reads against
 * it. The skin sits behind the notes, and this keeps it behind them in tone. */
const nebulaGain = 0.66;

/** The gas and stars are a shader on one quad; the rocks are drawn over it on a
 * 2D layer, because they are a handful of shapes that have to answer to where
 * the notes are and that is not worth a second pipeline. */
function createStarfield({ base, overlay }: SkinSurface): SkinInstance | null {
  const gl = base.getContext("webgl2", {
    alpha: false,
    antialias: false,
    powerPreference: "low-power",
  });
  if (gl === null) {
    return null;
  }
  const gas = createFullscreen(gl, nebulaSource(0.015));
  if (gas === null) {
    return null;
  }
  const ctx = overlay.getContext("2d");

  const field = new RockField({
    max: 14,
    rate: 2.7,
    smallest: 11,
    largest: 28,
  });
  let width = 0;
  let height = 0;
  let ratio = 1;
  let last = 0;

  return {
    resize(nextWidth, nextHeight, nextRatio) {
      width = nextWidth;
      height = nextHeight;
      ratio = nextRatio;
      base.width = Math.round(nextWidth * nextRatio);
      base.height = Math.round(nextHeight * nextRatio);
      overlay.width = base.width;
      overlay.height = base.height;
      gl.viewport(0, 0, base.width, base.height);
    },

    draw(frame: SkinFrame) {
      gas.draw([base.width, base.height], frame.elapsed, nebulaGain);
      if (ctx === null) {
        return;
      }
      const step =
        last === 0 ? 1 / 60 : Math.max(0, Math.min(0.05, frame.elapsed - last));
      last = frame.elapsed;

      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      field.paint(ctx, width, height, step, frame);
    },

    dispose() {
      gas.dispose();
    },
  };
}

export const starfield: Skin = {
  id: "starfield",
  name: "Deep space",
  blurb:
    "Drifting gas and stars. In free roam the notes you play break the asteroids they reach.",
  // The rocks are flown into, so they only read while notes leave the keys.
  directions: ["up"],
  create: createStarfield,
};
