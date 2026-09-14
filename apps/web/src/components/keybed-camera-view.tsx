"use client";

import { depthInKeyWidths, measureCorners } from "keybed";
import { Eye, Hand, RotateCcw, Ruler, Scan } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { keepDepth, keepFocal } from "@/lib/vision/calibration";
import {
  clearFrame,
  defaultFade,
  drawCameraLayer,
  drawHandles,
  drawQuad,
  drawWholeFrame,
} from "@/lib/vision/compose";
import type {
  KeybedCamera,
  Reading,
  TrackerState,
} from "@/lib/vision/keybed-camera";
import { nearestCorner, type Point, placeKeybed } from "@/lib/vision/placement";

const output = { width: 1280, height: 720 };

type View = "aim" | "composed";

function hint(state: TrackerState, reading: Reading | null): string {
  if (state.kind === "held") {
    return state.byHand ? "corners set by hand" : "keyboard held";
  }
  if (reading === null) {
    return "starting the camera";
  }
  return `${state.progress.reason} · ${state.progress.agreed}/4 reads · mask ${(
    reading.coverage * 100
  ).toFixed(0)}% · ${reading.latencyMs.toFixed(0)} ms`;
}

export function KeybedCameraView() {
  const video = useRef<HTMLVideoElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const camera = useRef<KeybedCamera | null>(null);
  const dragging = useRef<number | null>(null);
  const corners = useRef<Point[] | null>(null);
  const view = useRef<View>("aim");
  const [showing, setShowing] = useState<View>("aim");
  const [status, setStatus] = useState("starting the camera");
  const [byHand, setByHand] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const [measured, setMeasured] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    let stream: MediaStream | null = null;
    let frame = 0;

    const run = async (): Promise<void> => {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      const element = video.current;
      if (element === null || stop) {
        return;
      }
      element.srcObject = stream;
      await element.play();

      // The model and its runtime are megabytes, and nothing outside this page
      // wants them, so they arrive only once a camera is running.
      const { createKeybedCamera } = await import("@/lib/vision/keybed-camera");
      camera.current = await createKeybedCamera();
      const context = canvas.current?.getContext("2d") ?? null;

      const draw = (now: number): void => {
        frame = requestAnimationFrame(draw);
        const reader = camera.current;
        if (context === null || reader === null || element.videoWidth === 0) {
          return;
        }
        void reader.look(element, now);
        const state = reader.state();
        setStatus(hint(state, reader.reading()));
        setByHand(state.kind === "held" && state.byHand);
        if (state.kind === "held" && dragging.current === null) {
          corners.current = [...state.keybed.quad];
        }
        const size = { width: element.videoWidth, height: element.videoHeight };
        clearFrame(context, output);
        if (view.current === "aim" || state.kind !== "held") {
          drawWholeFrame(context, element, size, output);
          const quad = corners.current;
          if (quad !== null) {
            drawQuad(context, quad, size, output);
            drawHandles(context, quad, size, output);
          }
          return;
        }
        drawCameraLayer(
          context,
          element,
          size,
          placeKeybed(state.keybed, size, output),
          output,
          defaultFade,
        );
      };
      frame = requestAnimationFrame(draw);
    };

    run().catch((reason: unknown) => {
      setRefused(reason instanceof Error ? reason.message : `${reason}`);
    });

    return () => {
      stop = true;
      cancelAnimationFrame(frame);
      for (const track of stream?.getTracks() ?? []) {
        track.stop();
      }
    };
  }, []);

  /** What corners placed by hand can settle: the keybed's shape from a view
   * from above, or the camera's lens from an oblique one. The fit is only as
   * good as these, which is why a wrong-looking rectangle is worth correcting
   * by hand once. */
  const measure = (): void => {
    const quad = corners.current;
    const element = video.current;
    if (quad === null || element === null) {
      return;
    }
    const reading = measureCorners(quad, {
      width: element.videoWidth,
      height: element.videoHeight,
    });
    if (reading.kind === "refused") {
      setMeasured(`${reading.reason}, nothing measured`);
      return;
    }
    if (reading.kind === "depth") {
      keepDepth(reading.units);
      setMeasured(
        `shape measured: ${depthInKeyWidths(reading.units).toFixed(2)} key widths per depth`,
      );
    } else {
      keepFocal(reading.fraction);
      setMeasured(
        `lens measured: focal ${reading.fraction.toFixed(2)} of the frame width`,
      );
    }
    camera.current?.release();
  };

  /** Where a pointer sits inside the drawn frame, as a share of it. */
  const framePoint = (event: React.PointerEvent<HTMLCanvasElement>): Point => {
    const box = event.currentTarget.getBoundingClientRect();
    const element = video.current;
    const size = {
      width: element?.videoWidth ?? output.width,
      height: element?.videoHeight ?? output.height,
    };
    const scale = Math.min(
      output.width / size.width,
      output.height / size.height,
    );
    const insetX = (output.width - size.width * scale) / 2;
    const insetY = (output.height - size.height * scale) / 2;
    const x = ((event.clientX - box.left) / box.width) * output.width;
    const y = ((event.clientY - box.top) / box.height) * output.height;
    return {
      x: (x - insetX) / (size.width * scale),
      y: (y - insetY) / (size.height * scale),
    };
  };

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-void">
      <header className="flex h-14 shrink-0 items-center gap-3 border-line border-b bg-panel px-4">
        <h1 className="label">keybed camera</h1>
        <p className="min-w-0 flex-1 truncate font-mono text-[0.7rem] text-faint">
          {refused ?? measured ?? status}
        </p>
        {showing === "aim" ? (
          <button
            type="button"
            onClick={measure}
            aria-label="Measure the keyboard from these corners"
            data-tip="Measure the keyboard from these corners"
            data-tip-side="bottom"
            className="shrink-0 rounded-lg p-1.5 text-faint transition-colors hover:bg-raised hover:text-accent pointer-coarse:min-h-11"
          >
            <Ruler className="size-4" aria-hidden="true" />
          </button>
        ) : null}
        {byHand ? (
          <button
            type="button"
            onClick={() => {
              setMeasured(null);
              camera.current?.release();
            }}
            aria-label="Find the keyboard again"
            data-tip="Find the keyboard again"
            data-tip-side="bottom"
            className="shrink-0 rounded-lg p-1.5 text-faint transition-colors hover:bg-raised hover:text-accent pointer-coarse:min-h-11"
          >
            <RotateCcw className="size-4" aria-hidden="true" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => {
            view.current = "aim";
            setShowing("aim");
          }}
          aria-pressed={showing === "aim"}
          aria-label="Aim the camera and drag the corners"
          data-tip="Aim the camera and drag the corners"
          data-tip-side="bottom"
          className={`shrink-0 rounded-lg p-1.5 transition-colors pointer-coarse:min-h-11 ${
            showing === "aim"
              ? "text-accent"
              : "text-faint hover:bg-raised hover:text-accent"
          }`}
        >
          {byHand ? (
            <Hand className="size-4" aria-hidden="true" />
          ) : (
            <Eye className="size-4" aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          onClick={() => {
            view.current = "composed";
            setShowing("composed");
          }}
          aria-pressed={showing === "composed"}
          aria-label="Show the keys alone"
          data-tip="Show the keys alone"
          data-tip-side="bottom"
          data-tip-align="right"
          className={`shrink-0 rounded-lg p-1.5 transition-colors pointer-coarse:min-h-11 ${
            showing === "composed"
              ? "text-accent"
              : "text-faint hover:bg-raised hover:text-accent"
          }`}
        >
          <Scan className="size-4" aria-hidden="true" />
        </button>
      </header>

      <div className="relative flex min-h-0 flex-1 items-center justify-center p-4">
        <canvas
          ref={canvas}
          width={output.width}
          height={output.height}
          onPointerDown={(event) => {
            if (showing !== "aim" || corners.current === null) {
              return;
            }
            const found = nearestCorner(corners.current, framePoint(event));
            if (found === null) {
              return;
            }
            dragging.current = found;
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const index = dragging.current;
            const quad = corners.current;
            if (index === null || quad === null) {
              return;
            }
            quad[index] = framePoint(event);
          }}
          onPointerUp={() => {
            const quad = corners.current;
            if (dragging.current !== null && quad !== null) {
              camera.current?.hold(quad);
            }
            dragging.current = null;
          }}
          className="max-h-full max-w-full rounded-xl border border-line bg-void"
        />
        {/* The camera feeds the canvas and is never shown on its own, so what
            leaves this page is only ever what the canvas holds. */}
        <video ref={video} className="hidden" muted playsInline />
      </div>
    </div>
  );
}
