"use client";

import {
  createDetector,
  createSteady,
  type Detector,
  lockKeybed,
  type Point,
  type Steady,
} from "keybed";
import { browserAssets, keybedModelUrl } from "@/lib/vision/assets";
import { applyStoredCalibration } from "@/lib/vision/calibration";
import type { Keybed } from "@/lib/vision/placement";

/** While it hunts, the model runs often. Once the keybed is held, it only has
 * to answer whether the keyboard is still there, which is a slow question: the
 * instrument does not move while it is played. */
export const searchEveryMs = 350;
export const confirmEveryMs = 1000;

/** How many agreeing reads in a row it takes to hold a keybed, and how far
 * apart two reads may sit and still agree, as a share of the frame. */
export const readsToHold = 4;
export const agreeWithin = 0.02;

/** How many refusals in a row put the camera away again. */
export const missesBeforeLost = 3;

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

export async function createKeybedCamera(): Promise<KeybedCamera> {
  applyStoredCalibration();
  const detector: Detector = await createDetector(
    browserAssets,
    keybedModelUrl,
  );
  const steady: Steady = createSteady();

  let state: TrackerState = {
    kind: "hunting",
    progress: { agreed: 0, reason: "looking for a keyboard" },
  };
  let reading: Reading | null = null;
  let agreeing: Point[] | null = null;
  let agreed = 0;
  let misses = 0;
  let byHand: readonly Point[] | null = null;
  let looking = false;
  let lastAt = 0;

  const hunt = (): void => {
    state = { kind: "hunting", progress: { agreed, reason: huntReason } };
  };
  let huntReason = "looking for a keyboard";

  return {
    look: async (frame, now) => {
      const every = state.kind === "held" ? confirmEveryMs : searchEveryMs;
      if (looking || now - lastAt < every) {
        return;
      }
      looking = true;
      lastAt = now;
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
          if (misses < missesBeforeLost) {
            return;
          }
          agreed = 0;
          agreeing = null;
          steady.reset();
          if (byHand === null) {
            hunt();
          }
          return;
        }

        misses = 0;
        const settled = steady.accept(lock.quad, detection.still);
        if (byHand !== null) {
          return;
        }
        if (
          agreeing !== null &&
          farthestCorner(settled, agreeing) < agreeWithin
        ) {
          agreed = Math.min(readsToHold, agreed + 1);
        } else {
          agreed = 1;
        }
        agreeing = settled;
        huntReason = "reading the keyboard";
        if (agreed >= readsToHold) {
          state = { kind: "held", keybed: keybedOf(settled), byHand: false };
          return;
        }
        hunt();
      } finally {
        looking = false;
      }
    },
    state: () => state,
    reading: () => reading,
    hold: (quad) => {
      byHand = quad;
      state = { kind: "held", keybed: keybedOf(quad), byHand: true };
    },
    release: () => {
      byHand = null;
      agreed = 0;
      agreeing = null;
      steady.reset();
      hunt();
    },
  };
}
