import {
  createFullscreen,
  type Fullscreen,
  shaderContext,
} from "@/lib/skins/fullscreen";
import type {
  Skin,
  SkinFrame,
  SkinId,
  SkinInstance,
  SkinSurface,
} from "@/lib/skins/types";
import { skinDirections } from "@/lib/skins/types";

/** The surface a scene paints on, in css pixels. */
export type SceneView = {
  readonly width: number;
  readonly height: number;
  /** Where the keys begin, which is the line notes travel from or toward. */
  readonly keyboardTop: number;
};

/** What the shader is told about the music, so a background can answer to the
 * playing without any skin having to know what a note is. */
export type Mood = {
  /** Where the sound sits across the keyboard, 0 at the lowest key and 1 at the
   * highest. */
  readonly tone: number;
  /** How much is going on, 0 for silence and 1 for a full handful. */
  readonly energy: number;
};

/** A background reduced to the only things that differ between them: what to
 * paint, and what to tell the shader. Contexts, device ratio, sizing, clearing
 * and the clock all belong to the host. Both members are optional, so a skin
 * can be a shader alone, a painting alone, or both. */
export type Scene = {
  paint?(
    ctx: CanvasRenderingContext2D,
    view: SceneView,
    frame: SkinFrame,
    step: number,
  ): void;
  mood?(frame: SkinFrame, view: SceneView): Mood;
  dispose?(): void;
};

export type SkinSpec = {
  readonly id: SkinId;
  readonly name: string;
  readonly blurb: string;
  /** A shader for the layer under the painting. A skin without one never asks
   * for WebGL, so it runs anywhere a canvas does. */
  readonly shader?: { readonly source: string; readonly gain: number };
  createScene(): Scene;
};

/** A frame longer than this is a tab coming back or a stall, and moving the
 * whole scene by it would teleport everything. */
const longestStep = 0.05;

const still: Mood = { tone: 0.5, energy: 0 };

/** Builds a skin from the parts that are actually its own. Everything a
 * background used to repeat lives here once. */
export function defineSkin(spec: SkinSpec): Skin {
  return {
    id: spec.id,
    name: spec.name,
    blurb: spec.blurb,
    directions: skinDirections[spec.id],

    create({ base, overlay }: SkinSurface): SkinInstance | null {
      const ctx = overlay.getContext("2d");
      if (ctx === null) {
        return null;
      }

      let gl: WebGL2RenderingContext | null = null;
      let shader: Fullscreen | null = null;
      if (spec.shader !== undefined) {
        gl = shaderContext(base);
        if (gl === null) {
          return null;
        }
        shader = createFullscreen(gl, spec.shader.source);
        if (shader === null) {
          return null;
        }
      }

      const scene = spec.createScene();
      // One object reused every frame: a skin reads it and never keeps it.
      const view = { width: 0, height: 0, keyboardTop: 0 };
      let ratio = 1;
      let last = 0;

      return {
        resize(width, height, nextRatio) {
          ratio = nextRatio;
          view.width = width;
          view.height = height;
          overlay.width = Math.round(width * ratio);
          overlay.height = Math.round(height * ratio);
          if (gl !== null) {
            base.width = overlay.width;
            base.height = overlay.height;
            gl.viewport(0, 0, base.width, base.height);
          }
        },

        draw(frame: SkinFrame) {
          const step =
            last === 0
              ? 1 / 60
              : Math.max(0, Math.min(longestStep, frame.elapsed - last));
          last = frame.elapsed;
          view.keyboardTop = frame.keyboardTop;

          if (shader !== null && spec.shader !== undefined) {
            const mood = scene.mood?.(frame, view) ?? still;
            shader.draw([base.width, base.height], {
              time: frame.elapsed,
              gain: spec.shader.gain,
              tone: mood.tone,
              energy: mood.energy,
            });
          }

          if (scene.paint !== undefined && view.width > 0) {
            ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
            ctx.clearRect(0, 0, view.width, view.height);
            scene.paint(ctx, view, frame, step);
            ctx.globalAlpha = 1;
          }
        },

        dispose() {
          scene.dispose?.();
          shader?.dispose();
        },
      };
    },
  };
}

/** Where the notes sit and how many there are, from whichever of the two the
 * roll is reporting. A falling song has no travellers, only the moment a note
 * lands, so a skin reads the same either way. */
export function moodOf(frame: SkinFrame, view: SceneView): Mood {
  const marks = frame.travellers.length > 0 ? frame.travellers : frame.strikes;
  if (marks.length === 0 || view.width === 0) {
    return still;
  }
  let across = 0;
  for (const mark of marks) {
    across += mark.x;
  }
  return {
    tone: Math.min(1, Math.max(0, across / marks.length / view.width)),
    energy: Math.min(1, marks.length / 6),
  };
}
