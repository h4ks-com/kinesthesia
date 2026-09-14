"use client";

import {
  buildSkinAlpha,
  createSkinSegmenter,
  type SkinSegmenter,
} from "keybed";
import { browserAssets } from "@/lib/vision/assets";

/** How often the skin is read. The notes move every frame, the hands over them
 * do not have to be cut out every frame to read as being in front. */
export const segmentEveryMs = 110;

/** MediaPipe's runtime announces the TensorFlow Lite delegate it picked on
 * console.error the first time it runs an inference. Next's overlay reads any
 * console.error as a fault and puts it in front of the page, so that one notice
 * is dropped while the segmenter starts. */
function quietDelegateNotice(): () => void {
  const spoke = console.error;
  console.error = (...said: unknown[]): void => {
    const first = said[0];
    if (
      typeof first === "string" &&
      first.startsWith("INFO: Created TensorFlow")
    ) {
      return;
    }
    spoke(...said);
  };
  return () => {
    console.error = spoke;
  };
}

export type HandLayer = {
  /** Reads the picture, keeping whatever skin it finds cut out of it. */
  readonly look: (frame: HTMLVideoElement, now: number) => void;
  /** The hands alone, on a transparent ground, in the camera's own frame.
   * Null until the first read lands. */
  readonly layer: () => CanvasImageSource | null;
  readonly close: () => void;
};

/** The hands, cut out of the camera frame so they can be drawn over the notes.
 * Everything on the stage is above the keys except the player's own hands,
 * which are on them. */
export async function createHandLayer(): Promise<HandLayer> {
  let loud = quietDelegateNotice();
  const segmenter: SkinSegmenter = await createSkinSegmenter(browserAssets);
  const sheet = document.createElement("canvas");
  let context: CanvasRenderingContext2D | null = null;
  let lastAt = 0;
  let drawn = false;

  return {
    look: (frame, now) => {
      if (now - lastAt < segmentEveryMs || frame.videoWidth === 0) {
        return;
      }
      lastAt = now;
      const result = segmenter.segment(frame, now);
      loud();
      loud = () => {};
      const mask = result.categoryMask;
      if (mask === undefined) {
        return;
      }
      const skin = buildSkinAlpha(
        mask.getAsUint8Array(),
        mask.width,
        mask.height,
        [],
        false,
      );
      mask.close();
      if (skin === null || skin.coverage === 0) {
        drawn = false;
        return;
      }
      if (
        sheet.width !== frame.videoWidth ||
        sheet.height !== frame.videoHeight
      ) {
        sheet.width = frame.videoWidth;
        sheet.height = frame.videoHeight;
        context = null;
      }
      context ??= sheet.getContext("2d");
      if (context === null) {
        return;
      }
      context.clearRect(0, 0, sheet.width, sheet.height);
      context.drawImage(skin.canvas, 0, 0, sheet.width, sheet.height);
      context.globalCompositeOperation = "source-in";
      context.drawImage(frame, 0, 0, sheet.width, sheet.height);
      context.globalCompositeOperation = "source-over";
      drawn = true;
    },
    layer: () => (drawn ? sheet : null),
    close: () => {
      loud();
      segmenter.close();
    },
  };
}
