import { nebulaSource } from "@/lib/skins/fullscreen";
import { RockField } from "@/lib/skins/rubble";
import { defineSkin } from "@/lib/skins/scene";

/** Kept well under the roll's own brightness, so a note always reads against
 * it. The skin sits behind the notes, and this keeps it behind them in tone. */
const nebulaGain = 0.66;

export const starfield = defineSkin({
  id: "starfield",
  name: "Deep space",
  blurb:
    "Drifting gas and stars. The notes you play break the asteroids they reach.",
  shader: { source: nebulaSource(0.015), gain: nebulaGain },

  createScene() {
    const field = new RockField({
      max: 14,
      rate: 2.7,
      smallest: 11,
      largest: 28,
    });
    return {
      paint(ctx, view, frame, step) {
        field.paint(ctx, view.width, view.height, step, frame);
      },
    };
  },
});
