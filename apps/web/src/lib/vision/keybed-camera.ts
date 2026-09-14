"use client";

import {
  createDetector,
  type Detector,
  type Lock,
  lockKeybed,
  type Point,
} from "keybed";
import { browserAssets, keybedModelUrl } from "@/lib/vision/assets";
import type { Keybed } from "@/lib/vision/placement";

/** The keybed does not move while it is played, so the model runs on a slow
 * poll and what it found stands until it is refused this many times over. */
export const detectEveryMs = 700;
export const missesBeforeLost = 3;

export type Sighting =
  | { readonly found: true; readonly keybed: Keybed }
  | { readonly found: false; readonly reason: string };

export type KeybedCamera = {
  /** Reads the frame if enough time has passed, and says nothing otherwise. */
  readonly look: (frame: HTMLVideoElement, now: number) => Promise<void>;
  readonly sighting: () => Sighting;
};

/** The player stands at the near edge, which the detector orders last. */
function keybedFrom(lock: Extract<Lock, { held: true }>): Keybed {
  const quad: Point[] = lock.quad;
  return { quad, playerEdgeIsFirst: false };
}

export async function createKeybedCamera(): Promise<KeybedCamera> {
  const detector: Detector = await createDetector(
    browserAssets,
    keybedModelUrl,
  );
  let sighting: Sighting = { found: false, reason: "looking for a keyboard" };
  let misses = 0;
  let reading = false;
  let lastAt = 0;

  return {
    look: async (frame, now) => {
      if (reading || now - lastAt < detectEveryMs) {
        return;
      }
      reading = true;
      lastAt = now;
      try {
        const detection = await detector.detect(frame);
        const lock = lockKeybed(detection, {
          width: frame.videoWidth,
          height: frame.videoHeight,
        });
        if (lock.held) {
          misses = 0;
          sighting = { found: true, keybed: keybedFrom(lock) };
          return;
        }
        misses += 1;
        if (misses >= missesBeforeLost) {
          sighting = { found: false, reason: lock.reason };
        }
      } finally {
        reading = false;
      }
    },
    sighting: () => sighting,
  };
}
