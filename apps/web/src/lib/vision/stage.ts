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

export function clearFrame(
  context: CanvasRenderingContext2D,
  output: Size,
): void {
  context.fillStyle = "#07080b";
  context.fillRect(0, 0, output.width, output.height);
}

/** The whole camera frame, fitted inside the output. Used while aiming, where
 * seeing the room is the point. */
export function drawWholeFrame(
  context: CanvasRenderingContext2D,
  frame: CanvasImageSource,
  frameSize: Size,
  output: Size,
): void {
  const scale = Math.min(
    output.width / frameSize.width,
    output.height / frameSize.height,
  );
  const width = frameSize.width * scale;
  const height = frameSize.height * scale;
  context.drawImage(
    frame,
    (output.width - width) / 2,
    (output.height - height) / 2,
    width,
    height,
  );
}

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

/** Where a frame point lands on the output while the whole frame is shown. */
function onOutput(
  point: { x: number; y: number },
  frameSize: Size,
  output: Size,
): { x: number; y: number } {
  const scale = Math.min(
    output.width / frameSize.width,
    output.height / frameSize.height,
  );
  return {
    x:
      (output.width - frameSize.width * scale) / 2 +
      point.x * frameSize.width * scale,
    y:
      (output.height - frameSize.height * scale) / 2 +
      point.y * frameSize.height * scale,
  };
}

/** The keybed as the reader has to judge it: its outline, and the edge the
 * player stands at picked out, since the keys face one way and the notes have
 * to fall onto them the same way. */
export function drawQuad(
  context: CanvasRenderingContext2D,
  quad: readonly { x: number; y: number }[],
  frameSize: Size,
  output: Size,
): void {
  const points = quad.map((corner) => onOutput(corner, frameSize, output));
  const [back, backEnd, playerEnd, player] = points;
  if (
    back === undefined ||
    backEnd === undefined ||
    playerEnd === undefined ||
    player === undefined
  ) {
    return;
  }
  context.save();
  context.lineJoin = "round";
  context.strokeStyle = "rgba(76, 158, 255, 0.7)";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(back.x, back.y);
  for (const point of [backEnd, playerEnd, player]) {
    context.lineTo(point.x, point.y);
  }
  context.closePath();
  context.stroke();

  context.strokeStyle = "#4ade80";
  context.lineWidth = 4;
  context.beginPath();
  context.moveTo(player.x, player.y);
  context.lineTo(playerEnd.x, playerEnd.y);
  context.stroke();

  drawPlayerMark(context, points);
  context.restore();
}

/** Which way the keyboard faces, marked outside its near edge, since the keys
 * only make sense played from one side. */
function drawPlayerMark(
  context: CanvasRenderingContext2D,
  points: readonly { x: number; y: number }[],
): void {
  const [back, backEnd, playerEnd, player] = points;
  if (
    back === undefined ||
    backEnd === undefined ||
    playerEnd === undefined ||
    player === undefined
  ) {
    return;
  }
  const middle = {
    x: (player.x + playerEnd.x) / 2,
    y: (player.y + playerEnd.y) / 2,
  };
  const far = { x: (back.x + backEnd.x) / 2, y: (back.y + backEnd.y) / 2 };
  const away = { x: middle.x - far.x, y: middle.y - far.y };
  const length = Math.hypot(away.x, away.y) || 1;
  const at = {
    x: middle.x + (away.x / length) * 34,
    y: middle.y + (away.y / length) * 34,
  };
  context.save();
  context.fillStyle = "#4ade80";
  context.beginPath();
  context.arc(at.x, at.y - 7, 6, 0, Math.PI * 2);
  context.fill();
  context.beginPath();
  context.arc(at.x, at.y + 12, 11, Math.PI, 0);
  context.fill();
  context.restore();
}

/** A handle on each corner, so the reader can correct what the model read. */
export function drawHandles(
  context: CanvasRenderingContext2D,
  quad: readonly { x: number; y: number }[],
  frameSize: Size,
  output: Size,
): void {
  context.save();
  for (const corner of quad) {
    const point = onOutput(corner, frameSize, output);
    context.beginPath();
    context.arc(point.x, point.y, 9, 0, Math.PI * 2);
    context.fillStyle = "rgba(7, 8, 11, 0.75)";
    context.fill();
    context.lineWidth = 2;
    context.strokeStyle = "#4c9eff";
    context.stroke();
  }
  context.restore();
}
