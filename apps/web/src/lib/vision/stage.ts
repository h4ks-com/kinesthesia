import {
  defaultPlacement,
  keysBaseline,
  type Placement,
  type PlacementOptions,
  type Point,
  placePoint,
  type Size,
} from "@/lib/vision/placement";
import type { Bar } from "@/lib/vision/space";

/** Where a point of the camera frame lands on the output, which differs between
 * showing the whole picture and laying the keys along the bottom. Anything
 * drawn in the camera's own space goes through one of these. */
export type ToOutput = (point: Point) => Point;

/** How the camera layer is drawn once the keybed is placed: the keys sit at the
 * bottom, and the picture fades to black above them so nothing of the room, or
 * of the player, is on screen. */
export type Fade = {
  /** How far above the keys the picture still shows, as a share of the height. */
  readonly reach: number;
  /** How much of that is the fade itself. */
  readonly softness: number;
  /** How much of the picture dissolves at each of its own edges, as a share of
   * the frame. The camera frame ends somewhere, and a straight cut across the
   * room is the one thing that reads as a video pasted on a page. */
  readonly edges: number;
};

export const defaultFade: Fade = { reach: 0.62, softness: 0.8, edges: 0.12 };

/** Steps along the fade. A gradient with two stops bands, and its start is a
 * visible line across the picture; an eased ramp arrives out of nothing. */
const fadeSteps = 24;

let edgeVeil: HTMLCanvasElement | null = null;
let veilFor = "";

/** The fade at the frame's four edges, as a sheet of the stage's own colour
 * that is opaque at the border and clear inside. Painting it over the placed
 * picture leaves no edge, and it only changes when the camera does. */
function veilOfEdges(frameSize: Size, edges: number): HTMLCanvasElement | null {
  const wanted = `${frameSize.width}x${frameSize.height}x${edges}`;
  if (edgeVeil !== null && veilFor === wanted) {
    return edgeVeil;
  }
  edgeVeil ??= document.createElement("canvas");
  edgeVeil.width = frameSize.width;
  edgeVeil.height = frameSize.height;
  const context = edgeVeil.getContext("2d");
  if (context === null) {
    return null;
  }
  context.clearRect(0, 0, frameSize.width, frameSize.height);
  const deep = frameSize.width * edges;
  const tall = frameSize.height * edges;
  const sides: readonly {
    from: [number, number];
    to: [number, number];
    strip: [number, number, number, number];
  }[] = [
    { from: [0, 0], to: [deep, 0], strip: [0, 0, deep, frameSize.height] },
    {
      from: [frameSize.width, 0],
      to: [frameSize.width - deep, 0],
      strip: [frameSize.width - deep, 0, deep, frameSize.height],
    },
    { from: [0, 0], to: [0, tall], strip: [0, 0, frameSize.width, tall] },
    {
      from: [0, frameSize.height],
      to: [0, frameSize.height - tall],
      strip: [0, frameSize.height - tall, frameSize.width, tall],
    },
  ];
  for (const side of sides) {
    const ramp = context.createLinearGradient(
      side.from[0],
      side.from[1],
      side.to[0],
      side.to[1],
    );
    for (let step = 0; step <= fadeSteps; step += 1) {
      const at = step / fadeSteps;
      ramp.addColorStop(at, `rgba(0, 0, 0, ${(1 - at) ** 3})`);
    }
    context.fillStyle = ramp;
    context.fillRect(
      side.strip[0],
      side.strip[1],
      side.strip[2],
      side.strip[3],
    );
  }
  veilFor = wanted;
  return edgeVeil;
}

/** The stage is drawn on nothing, so whatever is mounted behind it, a
 * background or the page's own ground, shows through wherever the picture has
 * faded out. */
export function clearFrame(
  context: CanvasRenderingContext2D,
  output: Size,
): void {
  context.clearRect(0, 0, output.width, output.height);
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

/** Anything in the camera's own frame, laid where the keybed was placed. The
 * same steps `placePoint` takes, in the order the canvas applies them: turn
 * about the frame's own centre, then scale, then move into place. */
export function drawPlacedFrame(
  context: CanvasRenderingContext2D,
  frame: CanvasImageSource,
  frameSize: Size,
  placement: Placement,
): void {
  context.save();
  context.translate(placement.x, placement.y);
  context.scale(placement.scale, placement.scale);
  context.translate(frameSize.width / 2, frameSize.height / 2);
  context.rotate(placement.angle);
  context.translate(-frameSize.width / 2, -frameSize.height / 2);
  context.drawImage(frame, 0, 0, frameSize.width, frameSize.height);
  context.restore();
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
  drawPlacedFrame(context, frame, frameSize, placement);
  const veil = veilOfEdges(frameSize, fade.edges);
  if (veil !== null) {
    context.save();
    context.globalCompositeOperation = "destination-out";
    drawPlacedFrame(context, veil, frameSize, placement);
    context.restore();
  }

  // The room thins out on the way up from the keys, taking the picture with it,
  // so what is drawn behind the stage comes through above the instrument.
  const gradient = context.createLinearGradient(0, top, 0, keysAt);
  for (let step = 0; step <= fadeSteps; step += 1) {
    const at = step / fadeSteps;
    const alpha = (1 - Math.min(1, at / Math.max(fade.softness, 0.01))) ** 3;
    gradient.addColorStop(at, `rgba(0, 0, 0, ${alpha})`);
  }
  context.save();
  context.globalCompositeOperation = "destination-out";
  context.fillStyle = "#000";
  context.fillRect(0, 0, output.width, top);
  context.fillStyle = gradient;
  context.fillRect(0, top, output.width, keysAt - top);
  context.restore();
}

/** The whole picture shown inside the output, which is the view for aiming. */
export function wholeFrameMap(frameSize: Size, output: Size): ToOutput {
  const scale = Math.min(
    output.width / frameSize.width,
    output.height / frameSize.height,
  );
  const insetX = (output.width - frameSize.width * scale) / 2;
  const insetY = (output.height - frameSize.height * scale) / 2;
  return (point) => ({
    x: insetX + point.x * scale,
    y: insetY + point.y * scale,
  });
}

/** The keys laid along the bottom, which is the stage itself. */
export function placedMap(placement: Placement, frameSize: Size): ToOutput {
  return (point) => placePoint(point, placement, frameSize);
}

/** How a bar is painted: a fill, an outline, or both. */
export type BarStyle = {
  readonly fill: string | null;
  readonly edge: string | null;
  readonly width: number;
};

/** A note on its way to the keys, or the face of a key it lands on. */
export function drawBar(
  context: CanvasRenderingContext2D,
  bar: Bar,
  to: ToOutput,
  style: BarStyle,
): void {
  const [first, ...rest] = bar.map(to);
  if (first === undefined) {
    return;
  }
  context.beginPath();
  context.moveTo(first.x, first.y);
  for (const point of rest) {
    context.lineTo(point.x, point.y);
  }
  context.closePath();
  if (style.fill !== null) {
    context.fillStyle = style.fill;
    context.fill();
  }
  if (style.edge !== null) {
    context.strokeStyle = style.edge;
    context.lineWidth = style.width;
    context.stroke();
  }
}

/** The keybed as the reader has to judge it: its outline, and the edge the
 * player stands at picked out, since the keys face one way and the notes have
 * to fall onto them the same way. */
export function drawQuad(
  context: CanvasRenderingContext2D,
  quad: readonly Point[],
  to: ToOutput,
): void {
  const points = quad.map(to);
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
  points: readonly Point[],
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
  quad: readonly Point[],
  to: ToOutput,
): void {
  context.save();
  for (const corner of quad) {
    const point = to(corner);
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
