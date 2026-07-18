import { highestPitch, isBlackKey, lowestPitch } from "@/lib/midi/song";

export const keyWidthRange = { min: 18, max: 64 } as const;
export const defaultKeyWidth = 26;

const blackKeyWidthRatio = 0.6;
const blackKeyHeightRatio = 0.6;
const maxKeyboardHeight = 120;
const keyboardHeightRatio = 0.22;

export const whiteKeys: readonly number[] = buildWhiteKeys();

const whiteIndex = new Map<number, number>(
  whiteKeys.map((pitch, index) => [pitch, index]),
);

function buildWhiteKeys(): number[] {
  const keys: number[] = [];
  for (let pitch = lowestPitch; pitch <= highestPitch; pitch += 1) {
    if (!isBlackKey(pitch)) {
      keys.push(pitch);
    }
  }
  return keys;
}

export function clampKeyWidth(value: number): number {
  return Math.min(
    keyWidthRange.max,
    Math.max(keyWidthRange.min, Math.round(value)),
  );
}

export function keyCenter(pitch: number, whiteWidth: number): number {
  if (!isBlackKey(pitch)) {
    return ((whiteIndex.get(pitch) ?? 0) + 0.5) * whiteWidth;
  }
  return ((whiteIndex.get(pitch - 1) ?? 0) + 1) * whiteWidth;
}

export function blackKeyWidth(whiteWidth: number): number {
  return whiteWidth * blackKeyWidthRatio;
}

export function whiteKeyLeft(pitch: number, whiteWidth: number): number {
  return keyCenter(pitch, whiteWidth) - whiteWidth / 2;
}

/** The hit tester and the painter share this, so a tap always lands on the key
 * drawn under the finger. */
export function blackKeyLeft(pitch: number, whiteWidth: number): number {
  return keyCenter(pitch, whiteWidth) - blackKeyWidth(whiteWidth) / 2;
}

type KeyboardBand = {
  readonly top: number;
  readonly height: number;
};

export function keyboardBand(viewportHeight: number): KeyboardBand {
  const height = Math.min(
    maxKeyboardHeight,
    viewportHeight * keyboardHeightRatio,
  );
  return { top: viewportHeight - height, height };
}

export type KeyboardMetrics = {
  readonly whiteWidth: number;
  readonly total: number;
  readonly maxPan: number;
};

/** Keys never shrink below the player's chosen width, so a narrow screen shows
 * a window onto the keyboard that they drag sideways. */
export function keyboardMetrics(
  viewportWidth: number,
  keyWidth: number,
): KeyboardMetrics {
  const whiteWidth = Math.max(keyWidth, viewportWidth / whiteKeys.length);
  const total = whiteWidth * whiteKeys.length;
  return { whiteWidth, total, maxPan: Math.max(0, total - viewportWidth) };
}

export type KeyboardView = {
  readonly width: number;
  readonly height: number;
  readonly keyWidth: number;
  readonly pan: number;
};

export function pitchAtPoint(
  x: number,
  y: number,
  view: KeyboardView,
): number | null {
  const band = keyboardBand(view.height);
  if (y < band.top) {
    return null;
  }
  const { whiteWidth } = keyboardMetrics(view.width, view.keyWidth);
  const local = x + view.pan;

  if (y < band.top + band.height * blackKeyHeightRatio) {
    for (let pitch = lowestPitch; pitch <= highestPitch; pitch += 1) {
      if (!isBlackKey(pitch)) {
        continue;
      }
      const width = blackKeyWidth(whiteWidth);
      const left = blackKeyLeft(pitch, whiteWidth);
      if (local >= left && local <= left + width) {
        return pitch;
      }
    }
  }

  return whiteKeys[Math.floor(local / whiteWidth)] ?? null;
}
