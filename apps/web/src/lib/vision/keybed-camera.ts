"use client";

import {
  createDetector,
  createSteady,
  type Detector,
  lockKeybed,
  measureCorners,
  type Point,
  type Steady,
} from "keybed";
import { browserAssets, keybedModelUrl } from "@/lib/vision/assets";
import {
  applyStoredCalibration,
  keepDepth,
  keepFocal,
} from "@/lib/vision/calibration";
import type { Keybed } from "@/lib/vision/placement";

/** While it hunts, the model runs often. Once the keybed is held, it only has
 * to answer whether the keyboard is still there, which is a slow question: the
 * instrument does not move while it is played. */
export const searchEveryMs = 350;
export const confirmEveryMs = 2500;

/** How many agreeing reads in a row it takes to hold a keybed, and how far
 * apart two reads may sit and still agree, as a share of the frame. */
export const readsToHold = 4;
export const agreeWithin = 0.02;

/** How many refusals in a row put the camera away again. A keybed already held
 * is given far longer: hands cover the keys for as long as they are played, and
 * the instrument has not gone anywhere. */
export const missesBeforeLost = 3;
export const missesWhileHeld = 20;

/** How far the confirming read may sit from the held corners and still count as
 * the same keyboard, as a share of the frame. */
export const staysWithin = 0.12;

export type Progress = {
  /** Reads agreeing so far, out of `readsToHold`. */
  readonly agreed: number;
  readonly reason: string;
};

export type TrackerState =
  | { readonly kind: "hunting"; readonly progress: Progress }
  | {
      readonly kind: "held";
      readonly keybed: Keybed;
      /** True where the corners are the ones a person dragged. */
      readonly byHand: boolean;
    };

/** What the last read cost and saw, so a reader can aim the camera. */
export type Reading = {
  readonly latencyMs: number;
  readonly coverage: number;
  readonly confidence: number;
};

export type CameraOptions = {
  /** Told when a held keybed stops being there, so whatever draws it can stop.
   * We never move a held keybed under the player: it is held or it is gone. */
  readonly onLost?: () => void;
};

export type KeybedCamera = {
  readonly look: (frame: HTMLVideoElement, now: number) => Promise<void>;
  readonly state: () => TrackerState;
  readonly reading: () => Reading | null;
  /** Takes the corners a person dragged, which hold until they are cleared. */
  readonly hold: (quad: readonly Point[]) => void;
  readonly release: () => void;
};

function farthestCorner(a: readonly Point[], b: readonly Point[]): number {
  let worst = 0;
  for (let index = 0; index < 4; index += 1) {
    const one = a[index];
    const other = b[index];
    if (one === undefined || other === undefined) {
      return Number.POSITIVE_INFINITY;
    }
    worst = Math.max(worst, Math.hypot(one.x - other.x, one.y - other.y));
  }
  return worst;
}

/** The player stands at the near edge, which the detector orders last. */
function keybedOf(quad: readonly Point[]): Keybed {
  return { quad, playerEdgeIsFirst: false };
}

export async function createKeybedCamera(
  options: CameraOptions = {},
): Promise<KeybedCamera> {
  applyStoredCalibration();
  const detector: Detector = await createDetector(
    browserAssets,
    keybedModelUrl,
  );
  const steady: Steady = createSteady();

  let state: TrackerState = {
    kind: "hunting",
    progress: { agreed: 0, reason: "Finding piano pattern" },
  };
  let reading: Reading | null = null;
  let agreeing: Point[] | null = null;
  let agreed = 0;
  let misses = 0;
  let byHand: readonly Point[] | null = null;
  let looking = false;
  let lastAt = 0;

  let huntReason = "Finding piano pattern";
  let size = { width: 0, height: 0 };

  const hunt = (): void => {
    state = { kind: "hunting", progress: { agreed, reason: huntReason } };
  };

  const lose = (): void => {
    const wasHeld = state.kind === "held";
    agreed = 0;
    agreeing = null;
    byHand = null;
    steady.reset();
    hunt();
    if (wasHeld) {
      options.onLost?.();
    }
  };

  /** Corners are only as good as the shape and lens the fit assumes, so every
   * time they settle we measure what they say and keep it for this browser. */
  const settle = (quad: readonly Point[], fromHand: boolean): void => {
    const reading = measureCorners(quad, size);
    if (reading.kind === "depth") {
      keepDepth(reading.units);
    } else if (reading.kind === "focal") {
      keepFocal(reading.fraction);
    }
    byHand = fromHand ? quad : null;
    state = { kind: "held", keybed: keybedOf(quad), byHand: fromHand };
  };

  return {
    look: async (frame, now) => {
      const every = state.kind === "held" ? confirmEveryMs : searchEveryMs;
      if (looking || now - lastAt < every) {
        return;
      }
      looking = true;
      lastAt = now;
      size = { width: frame.videoWidth, height: frame.videoHeight };
      try {
        const detection = await detector.detect(frame);
        reading = {
          latencyMs: detection.latencyMs,
          coverage: detection.coverage,
          confidence: detection.confidence,
        };
        const lock = lockKeybed(detection, {
          width: frame.videoWidth,
          height: frame.videoHeight,
        });

        if (!lock.held) {
          huntReason = lock.reason;
          misses += 1;
          const patience =
            state.kind === "held" ? missesWhileHeld : missesBeforeLost;
          if (misses < patience) {
            return;
          }
          lose();
          return;
        }

        misses = 0;
        // A held keybed is not re-fitted under the player. The slow read only
        // asks whether the keyboard is still where it was, and corners set by
        // hand are the reader's answer and outlast any read.
        if (state.kind === "held") {
          if (farthestCorner(lock.quad, state.keybed.quad) > staysWithin) {
            misses = missesBeforeLost;
            huntReason = "Piano pattern moved out of place";
            lose();
            return;
          }
          if (byHand === null) {
            state = {
              kind: "held",
              keybed: keybedOf(steady.accept(lock.quad, detection.still)),
              byHand: false,
            };
          }
          return;
        }

        const settled = steady.accept(lock.quad, detection.still);
        if (
          agreeing !== null &&
          farthestCorner(settled, agreeing) < agreeWithin
        ) {
          agreed = Math.min(readsToHold, agreed + 1);
        } else {
          agreed = 1;
        }
        agreeing = settled;
        huntReason = "Reading the piano pattern";
        if (agreed >= readsToHold) {
          settle(settled, false);
          return;
        }
        hunt();
      } finally {
        looking = false;
      }
    },
    state: () => state,
    reading: () => reading,
    hold: (quad) => settle(quad, true),
    release: () => {
      huntReason = "Finding piano pattern";
      lose();
    },
  };
}
