/** Starfield, as a background script. Source rather than a module because it
 * is evaluated inside the worker, the same way one somebody wrote is. */
export const starfieldScript = `
/** Kept well under the roll's own brightness, so a note always reads against
 * it. The skin sits behind the notes, and this keeps it behind them in tone. */
const nebulaGain = 0.66;

background({
  name: "Deep space",
  blurb:
    "Drifting gas and stars. The notes you play break the asteroids they reach.",
  directions: ["up"],
  shader: { source: nebulaSource(0.015), gain: nebulaGain },

  create() {
    const field = new RockField({
      max: 14,
      rate: 2.7,
      smallest: 11,
      largest: 28,
    });
    return {
      paint(ctx, view, frame) {
        field.paint(ctx, view.width, view.height, frame.step, frame);
      },
    };
  },
});
`;
