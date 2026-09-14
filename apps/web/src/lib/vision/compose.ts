import {
  defaultPlacement,
  keysBaseline,
  type Placement,
  type PlacementOptions,
  type Size,
} from "@/lib/vision/placement";

/** How the camera layer is drawn once the keybed is placed: the keys sit at the
 * bottom, and the picture fades to black above them so nothing of the room, or
 * of the player, is on screen. */
export type Fade = {
  /** How far above the keys the picture still shows, as a share of the height. */
  readonly reach: number;
  /** How much of that is the fade itself. */
  readonly softness: number;
};

export const defaultFade: Fade = { reach: 0.42, softness: 0.55 };

export function drawCameraLayer(
  context: CanvasRenderingContext2D,
  frame: CanvasImageSource,
  frameSize: Size,
  placement: Placement,
  output: Size,
  fade: Fade,
  options: PlacementOptions = defaultPlacement,
): void {
  const keysAt = keysBaseline(output, options);
  const top = keysAt - output.height * fade.reach;
  context.save();
  context.beginPath();
  context.rect(0, top, output.width, output.height - top);
  context.clip();
  // The same steps `placePoint` takes, in the order the canvas applies them:
  // turn about the frame's own centre, then scale, then move into place.
  context.save();
  context.translate(placement.x, placement.y);
  context.scale(placement.scale, placement.scale);
  context.translate(frameSize.width / 2, frameSize.height / 2);
  context.rotate(placement.angle);
  context.translate(-frameSize.width / 2, -frameSize.height / 2);
  context.drawImage(frame, 0, 0, frameSize.width, frameSize.height);
  context.restore();

  // The gradient runs from the room down towards the keys, so the picture
  // arrives out of the background rather than sitting in a box.
  const gradient = context.createLinearGradient(0, top, 0, keysAt);
  gradient.addColorStop(0, "rgba(0, 0, 0, 1)");
  gradient.addColorStop(Math.min(1, fade.softness), "rgba(0, 0, 0, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, top, output.width, keysAt - top);
  context.restore();
}
