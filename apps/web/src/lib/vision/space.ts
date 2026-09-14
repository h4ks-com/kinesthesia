import {
  cameraPosition,
  isBlack,
  keybedDepth,
  keyUnits,
  type PlanePose,
  type Point,
  projectSpace,
  solvePose,
  spaceDepth,
  WHITE_KEY_COUNT,
} from "keybed";
import type { Keybed, Size } from "@/lib/vision/placement";

/** The keyboard in front of the camera, as the MIDI pitches of its end keys.
 * Notes are laid across the keybed as fractions of this, so a board with more
 * keys than this says slides every note sideways. */
export type PitchRange = {
  readonly lowest: number;
  readonly highest: number;
};

/** The keys of the keybed the pose spans, which is what `along` is a share of.
 * A board with another number of keys on it is still this wide. */
export const spanInKeys = WHITE_KEY_COUNT;

/** How far a note stands off the keys when it is `lookAhead` seconds away, in
 * white-key widths. The runway is about as long as the keyboard is wide. */
export const runwayLength = WHITE_KEY_COUNT;

/** How far up the runway is worth looking, in white-key widths. Where a camera
 * stands decides how much of a plane leaving the keys stays in the picture, so
 * the runway is fitted to the view rather than run off the top of it. */
export function runwayInView(
  space: KeybedSpace,
  onto: (point: Point) => Point,
  top: number,
): number {
  const reaches = (away: number): boolean => {
    const found = space.at(0.5, away);
    return found !== null && onto(found).y > top;
  };
  if (reaches(runwayLength)) {
    return runwayLength;
  }
  let near = 0;
  let far = runwayLength;
  for (let step = 0; step < 20; step += 1) {
    const middle = (near + far) / 2;
    if (reaches(middle)) {
      near = middle;
    } else {
      far = middle;
    }
  }
  return near;
}

/** How the runway leans: 0 carries the keybed's own plane off behind the
 * instrument, 1 stands the notes up square to the camera. Between the two the
 * roll keeps the keys' perspective and still faces the room. */
export const runwayLean = 0.55;

/** How much of the keybed's depth a black key takes, measured from the far
 * edge, where the black keys start. */
const blackKeyDepth = 0.62;

/** Closer to the camera than this a point is behind the lens or on top of it,
 * and the picture it would be drawn in does not exist. */
const nearestDrawable = 1;

export type Bar = readonly [Point, Point, Point, Point];

export type KeybedSpace = {
  readonly pose: PlanePose;
  /** Where a point of the runway lands in the camera frame, in pixels, or null
   * where it sits behind the camera. `along` is a share of the keys' span and
   * `away` is white-key widths out from the far edge of the keys. */
  readonly at: (along: number, away: number) => Point | null;
  /** Where a point of the keys themselves lands: `across` runs from the far
   * edge of the keybed at 0 to the player's edge at 1. */
  readonly onKeys: (along: number, across: number) => Point | null;
};

/** The runway leaves the far edge of the keys, so the notes arrive over the
 * black keys and never over the player's hands. */
function runwayAxis(pose: PlanePose): { v: number; w: number } {
  const camera = cameraPosition(pose);
  const up = camera.w < 0 ? -1 : 1;
  const facing = { v: -up * camera.w, w: up * camera.v };
  const length = Math.hypot(facing.v, facing.w) || 1;
  const leaning = {
    v: runwayLean * (facing.v / length) - (1 - runwayLean),
    w: runwayLean * (facing.w / length),
  };
  const size = Math.hypot(leaning.v, leaning.w) || 1;
  return { v: leaning.v / size, w: leaning.w / size };
}

/** The detector orders the player's edge last and the pose reads a keybed the
 * other way round, so the corners are turned to face it. */
function poseCorners(keybed: Keybed, frame: Size): Point[] {
  const pixels = keybed.quad.map((corner) => ({
    x: corner.x * frame.width,
    y: corner.y * frame.height,
  }));
  const turned = keybed.playerEdgeIsFirst
    ? [pixels[2], pixels[3], pixels[0], pixels[1]]
    : pixels;
  return turned.flatMap((corner) => (corner === undefined ? [] : [corner]));
}

export function keybedSpace(keybed: Keybed, frame: Size): KeybedSpace | null {
  const corners = poseCorners(keybed, frame);
  if (corners.length < 4 || frame.width === 0 || frame.height === 0) {
    return null;
  }
  const pose = solvePose(corners, frame.width, frame.height);
  const axis = runwayAxis(pose);
  const project = (u: number, v: number, w: number): Point | null => {
    if (spaceDepth(pose, u, v, w) < nearestDrawable) {
      return null;
    }
    return projectSpace(pose, u, v, w, frame.width, frame.height);
  };
  return {
    pose,
    at: (along, away) =>
      project(along * WHITE_KEY_COUNT, away * axis.v, away * axis.w),
    onKeys: (along, across) =>
      project(along * WHITE_KEY_COUNT, across * keybedDepth(), 0),
  };
}

/** How many white keys a board carries, which is what its span is measured in. */
export function whiteKeysOf(range: PitchRange): number {
  return keyUnits(range.highest).to - keyUnits(range.lowest).from;
}

/** Where a key sits across the keybed, as shares of its span. */
export function keyBand(
  pitch: number,
  range: PitchRange,
): { readonly from: number; readonly to: number } {
  const keys = whiteKeysOf(range);
  const start = keyUnits(range.lowest).from;
  const units = keyUnits(pitch);
  return { from: (units.from - start) / keys, to: (units.to - start) / keys };
}

function quad(corners: readonly (Point | null)[]): Bar | null {
  const [a, b, c, d] = corners;
  if (
    a === undefined ||
    b === undefined ||
    c === undefined ||
    d === undefined ||
    a === null ||
    b === null ||
    c === null ||
    d === null
  ) {
    return null;
  }
  return [a, b, c, d];
}

/** The key itself, drawn flat on the instrument, which is how a reader sees
 * whether the notes land where the keys really are. */
export function keyFace(
  space: KeybedSpace,
  pitch: number,
  range: PitchRange,
): Bar | null {
  const band = keyBand(pitch, range);
  const near = isBlack(pitch) ? blackKeyDepth : 1;
  return quad([
    space.onKeys(band.from, 0),
    space.onKeys(band.to, 0),
    space.onKeys(band.to, near),
    space.onKeys(band.from, near),
  ]);
}

/** Every pitch the board carries, low to high. */
export function keysOf(range: PitchRange): readonly number[] {
  const keys: number[] = [];
  for (let pitch = range.lowest; pitch <= range.highest; pitch += 1) {
    keys.push(pitch);
  }
  return keys;
}
