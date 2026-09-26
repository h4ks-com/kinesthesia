import { describe, expect, it, vi } from "vitest";
import type { SongVoicing, Voicing } from "@/lib/audio/voicing";
import { paletteColor } from "@/lib/midi/palette";
import type { LiveNote } from "@/lib/midi/song";
import { channelPart, keyboardPart, playSong } from "@/lib/play/parts";
import { watchFrame } from "@/lib/render/export";
import { PianoRollRenderer } from "@/lib/render/piano-roll";

/** A 2D context that records the colour of every fill, in order. */
function recordingCanvas(): { canvas: HTMLCanvasElement; fills: string[] } {
  const fills: string[] = [];
  let fillStyle: unknown = "#000";
  const anything: ProxyHandler<object> = {
    get: (_target, key) => {
      if (key === "fillStyle") {
        return fillStyle;
      }
      if (key === "measureText") {
        return () => ({
          width: 8,
          actualBoundingBoxAscent: 6,
          actualBoundingBoxDescent: 2,
        });
      }
      if (key === "globalAlpha" || key === "lineWidth") {
        return 1;
      }
      return (..._args: unknown[]) => {
        if (
          (key === "fill" || key === "fillRect") &&
          typeof fillStyle === "string"
        ) {
          fills.push(fillStyle);
        }
        return new Proxy({}, anything);
      };
    },
    set: (_target, key, value) => {
      if (key === "fillStyle") {
        fillStyle = value;
      }
      return true;
    },
  };
  const context = new Proxy({}, anything) as CanvasRenderingContext2D;
  const canvas = document.createElement("canvas");
  vi.spyOn(canvas, "getContext").mockReturnValue(context);
  return { canvas, fills };
}

function voicing(color: number, front: boolean): Voicing {
  return {
    program: 0,
    attack: 0,
    release: 0,
    brightness: 20000,
    volume: 100,
    color,
    front,
  };
}

function held(
  id: number,
  track: number,
  pitch: number,
  start: number,
): LiveNote {
  return { id, pitch, track, velocity: 1, start, end: null, release: null };
}

describe("the roll's layers", () => {
  it("paints a part asked to the front over one a player sent later", () => {
    const parts = [keyboardPart(0), channelPart(1, 1, 0)];
    const voicings: SongVoicing = new Map([
      [0, voicing(2, true)],
      [1, voicing(5, false)],
    ]);
    const { canvas, fills } = recordingCanvas();
    const renderer = new PianoRollRenderer(canvas, 20, {
      width: 800,
      height: 400,
      ratio: 1,
    });
    renderer.draw({
      ...watchFrame(
        {
          song: playSong(parts),
          voicing: voicings,
          hiddenTracks: new Set(),
          plain: true,
          rate: 1,
          direction: "up",
          noteNames: false,
        },
        1,
      ),
      // The part in front was played first, so arrival order alone would bury
      // it under the one that came after.
      live: [held(1, 0, 60, 0.5), held(2, 1, 60, 0.6)],
      songPresses: false,
    });
    const front = fills.indexOf(paletteColor(2).flat);
    const behind = fills.indexOf(paletteColor(5).flat);
    expect(behind).toBeGreaterThanOrEqual(0);
    expect(front).toBeGreaterThan(behind);
  });

  it("leaves a hidden part's notes off the roll", () => {
    const parts = [keyboardPart(0), channelPart(1, 1, 0)];
    const voicings: SongVoicing = new Map([
      [0, voicing(2, false)],
      [1, voicing(5, false)],
    ]);
    const { canvas, fills } = recordingCanvas();
    const renderer = new PianoRollRenderer(canvas, 20, {
      width: 800,
      height: 400,
      ratio: 1,
    });
    renderer.draw({
      ...watchFrame(
        {
          song: playSong(parts),
          voicing: voicings,
          hiddenTracks: new Set([1]),
          plain: true,
          rate: 1,
          direction: "up",
          noteNames: false,
        },
        1,
      ),
      live: [held(1, 0, 60, 0.5), held(2, 1, 64, 0.6)],
      songPresses: false,
    });
    expect(fills).toContain(paletteColor(2).flat);
    expect(fills).not.toContain(paletteColor(5).flat);
  });
});
