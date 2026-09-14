import type { Point } from "keybed";

export type { Point };

/** Where the camera frame is drawn on the output, as a rotation about the
 * frame's centre, a scale, and a translation. The frame keeps its perspective:
 * flattening it would smear the hands, which stand above the keys. */
export type Placement = {
  readonly angle: number;
  readonly scale: number;
  readonly x: number;
  readonly y: number;
};

export type Size = {
  readonly width: number;
  readonly height: number;
};

/** Corner order from the detector: 0 to 1 runs along the keys, and 1 to 2
 * crosses the keybed's depth. `facing` says which of the long edges is the one
 * nearest the player. Corners are fractions of the frame, which is how the
 * detector reads them, so every one is turned into pixels before any angle or
 * distance is taken from it. */
export type Keybed = {
  readonly quad: readonly Point[];
  readonly playerEdgeIsFirst: boolean;
};

/** Corners arrive as fractions of the frame, and every distance, angle and
 * projection is taken in pixels. */
export function inPixels(point: Point, frame: Size): Point {
  return { x: point.x * frame.width, y: point.y * frame.height };
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** The edge the player stands at, which the output puts along the bottom. */
export function playerEdge(
  keybed: Keybed,
  frame: Size,
): readonly [Point, Point] {
  const [first, second, third, fourth] = keybed.quad;
  if (
    first === undefined ||
    second === undefined ||
    third === undefined ||
    fourth === undefined
  ) {
    throw new Error("A keybed is four corners");
  }
  const edge = keybed.playerEdgeIsFirst ? [first, second] : [fourth, third];
  return [inPixels(edge[0] as Point, frame), inPixels(edge[1] as Point, frame)];
}

/** How far the frame turns so the player's edge of the keys lies flat. */
export function keybedAngle(keybed: Keybed, frame: Size): number {
  const [from, to] = playerEdge(keybed, frame);
  return Math.atan2(to.y - from.y, to.x - from.x);
}

function rotate(point: Point, angle: number, about: Point): Point {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = point.x - about.x;
  const dy = point.y - about.y;
  return {
    x: about.x + dx * cos - dy * sin,
    y: about.y + dx * sin + dy * cos,
  };
}

export type PlacementOptions = {
  /** How much of the output width the keys span. */
  readonly fill: number;
  /** How far the keys sit above the bottom edge, as a share of the height. */
  readonly margin: number;
};

export const defaultPlacement: PlacementOptions = { fill: 0.9, margin: 0.04 };

/** Where the player's edge of the keys sits on the output. */
export function keysBaseline(
  output: Size,
  options: PlacementOptions = defaultPlacement,
): number {
  return output.height * (1 - options.margin);
}

/**
 * The transform that lays the keys flat along the bottom of the output. We turn
 * and scale the frame and never warp it, so the hands above the keys keep their
 * shape, and the notes are drawn into the same perspective instead.
 */
export function placeKeybed(
  keybed: Keybed,
  frame: Size,
  output: Size,
  options: PlacementOptions = defaultPlacement,
): Placement {
  const [from, to] = playerEdge(keybed, frame);
  const angle = -keybedAngle(keybed, frame);
  const scale = (output.width * options.fill) / Math.max(distance(from, to), 1);
  const centre = { x: frame.width / 2, y: frame.height / 2 };
  const edgeCentre = midpoint(
    rotate(from, angle, centre),
    rotate(to, angle, centre),
  );
  const target = {
    x: output.width / 2,
    y: output.height * (1 - options.margin),
  };
  return {
    angle,
    scale,
    x: target.x - (edgeCentre.x - centre.x) * scale - centre.x * scale,
    y: target.y - (edgeCentre.y - centre.y) * scale - centre.y * scale,
  };
}

/** The corner a pointer is over, or null where it is over none of them. */
export function nearestCorner(
  quad: readonly Point[],
  at: Point,
  within = 0.04,
): number | null {
  let best: number | null = null;
  let closest = within;
  for (const [index, corner] of quad.entries()) {
    const away = Math.hypot(corner.x - at.x, corner.y - at.y);
    if (away <= closest) {
      closest = away;
      best = index;
    }
  }
  return best;
}

/** Where a point of the camera frame lands on the output. */
export function placePoint(
  point: Point,
  placement: Placement,
  frame: Size,
): Point {
  const centre = { x: frame.width / 2, y: frame.height / 2 };
  const turned = rotate(point, placement.angle, centre);
  return {
    x: placement.x + turned.x * placement.scale,
    y: placement.y + turned.y * placement.scale,
  };
}
