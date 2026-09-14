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
import { createStillness, type Stillness } from "@/lib/vision/stillness";

/** While it hunts, the model runs often. Once the keybed is held it only has to
 * answer whether the keyboard is still there, which is a slow question: the
 * instrument does not move while it is played. */
export const searchEveryMs = 350;
export const confirmEveryMs = 2500;

/** How often a held keybed is looked at at all. Cheap: it compares a thumbnail
 * of everything around the keys against the last one, and wakes the model only
 * where the room has moved. A camera pointed at an instrument is still, so the
 * model costs nothing for as long as nothing happens. */
export const glanceEveryMs = 500;

/** However still the picture is, the model has the last word this often, so a
 * lock that drifted or a keyboard swapped out under it is caught. */
export const trustStillnessForMs = 30000;

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
    }
  /** Held once, and the keyboard is no longer where it was. Nothing is detected
   * again until the reader asks for it: a camera pointed at an instrument does
   * not lose it by accident, so this is worth saying rather than papering
   * over. */
  | { readonly kind: "lost"; readonly reason: string };

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
  const stillness: Stillness = createStillness();

  let state: TrackerState = {
    kind: "hunting",
    progress: { agreed: 0, reason: "Finding piano pattern" },
  };
  let reading: Reading | null = null;
  let agreeing: Point[] | null = null;
  let agreed = 0;
  let misses = 0;
  let looking = false;
  let lastAt = 0;
  let lastRanAt = 0;

  let huntReason = "Finding piano pattern";
  let size = { width: 0, height: 0 };

  const hunt = (): void => {
    state = { kind: "hunting", progress: { agreed, reason: huntReason } };
  };

  const forget = (): void => {
    agreed = 0;
    agreeing = null;
    steady.reset();
    stillness.forget();
  };

  /** The keyboard is not where it was. Nothing is detected again until it is
   * asked for, since a camera left pointing at an instrument does not lose it
   * by accident and a reader is owed the news. */
  const lose = (): void => {
    const wasHeld = state.kind === "held";
    forget();
    if (wasHeld) {
      state = { kind: "lost", reason: huntReason };
      options.onLost?.();
      return;
    }
    hunt();
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
    state = { kind: "held", keybed: keybedOf(quad), byHand: fromHand };
  };

  return {
    look: async (frame, now) => {
      // Nothing runs once the keyboard is gone: the reader asks for the next
      // detection themselves.
      if (state.kind === "lost") {
        return;
      }
      const holding = state.kind === "held" ? state.keybed.quad : null;
      const every = holding === null ? searchEveryMs : glanceEveryMs;
      if (looking || now - lastAt < every) {
        return;
      }
      lastAt = now;
      const held = holding !== null;
      const moved = stillness.changed(frame, holding);
      if (held && !moved && now - lastRanAt < trustStillnessForMs) {
        return;
      }
      if (held && moved && now - lastRanAt < confirmEveryMs) {
        return;
      }
      looking = true;
      lastRanAt = now;
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
        // Corners are never touched once they are held. The camera is pointed
        // at an instrument and left there, so the only question a read answers
        // from here is whether the keyboard is still where it was put.
        if (state.kind === "held") {
          if (farthestCorner(lock.quad, state.keybed.quad) > staysWithin) {
            misses = missesBeforeLost;
            huntReason = "Piano pattern moved out of place";
            lose();
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
    // Asked for by the reader, which is the one thing that always starts a
    // fresh hunt however the last one ended.
    release: () => {
      huntReason = "Finding piano pattern";
      forget();
      hunt();
    },
  };
}
