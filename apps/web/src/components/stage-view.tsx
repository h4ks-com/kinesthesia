"use client";

import { Loader2, RotateCcw, Scan, Video } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  type KeybedCamera,
  type Reading,
  readsToHold,
  type TrackerState,
} from "@/lib/vision/keybed-camera";
import { nearestCorner, type Point, placeKeybed } from "@/lib/vision/placement";
import {
  clearFrame,
  defaultFade,
  drawCameraLayer,
  drawHandles,
  drawQuad,
  drawWholeFrame,
} from "@/lib/vision/stage";

const output = { width: 1280, height: 720 };

type View = "camera" | "stage";

/** What the reader sees is the picture, so the detail goes to the console for
 * whoever is chasing a detection rather than into the frame. */
function report(state: TrackerState, reading: Reading | null): string {
  if (state.kind === "held") {
    return state.byHand ? "stage: corners set by hand" : "stage: pattern found";
  }
  const seen =
    reading === null
      ? ""
      : ` · mask ${(reading.coverage * 100).toFixed(0)}% · ${reading.latencyMs.toFixed(0)} ms`;
  return `stage: ${state.progress.reason} · ${state.progress.agreed}/${readsToHold} reads${seen}`;
}

export function StageView() {
  const video = useRef<HTMLVideoElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const camera = useRef<KeybedCamera | null>(null);
  const dragging = useRef<number | null>(null);
  const corners = useRef<Point[] | null>(null);
  const view = useRef<View>("camera");
  const [showing, setShowing] = useState<View>("camera");
  const [status, setStatus] = useState("starting the camera");
  const [hunting, setHunting] = useState(true);
  const [byHand, setByHand] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);

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
      let lastSaid = "";

      const draw = (now: number): void => {
        frame = requestAnimationFrame(draw);
        const reader = camera.current;
        if (context === null || reader === null || element.videoWidth === 0) {
          return;
        }
        void reader.look(element, now);
        const state = reader.state();
        const said = report(state, reader.reading());
        if (said !== lastSaid) {
          lastSaid = said;
          console.info(said);
        }
        setHunting(state.kind !== "held");
        setByHand(state.kind === "held" && state.byHand);
        if (state.kind === "held" && dragging.current === null) {
          corners.current = [...state.keybed.quad];
        }
        const size = { width: element.videoWidth, height: element.videoHeight };
        clearFrame(context, output);
        if (state.kind !== "held") {
          context.filter = "blur(14px) brightness(0.6)";
          drawWholeFrame(context, element, size, output);
          context.filter = "none";
          return;
        }
        if (view.current === "camera") {
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
        <h1 className="label">stage</h1>
        <p className="min-w-0 flex-1 truncate font-mono text-[0.7rem] text-warn">
          {refused ?? ""}
        </p>
        <button
          type="button"
          onClick={() => camera.current?.release()}
          aria-label="Detect the keybed again"
          data-tip="Detect the keybed again"
          data-tip-side="bottom"
          data-tip-align="right"
          className="shrink-0 rounded-lg p-1.5 text-faint transition-colors hover:bg-raised hover:text-accent pointer-coarse:min-h-11"
        >
          <RotateCcw className="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => {
            const next = showing === "camera" ? "stage" : "camera";
            view.current = next;
            setShowing(next);
          }}
          aria-pressed={showing === "stage"}
          aria-label={
            showing === "stage" ? "Show the camera" : "Preview the stage"
          }
          data-tip={
            showing === "stage" ? "Show the camera" : "Preview the stage"
          }
          data-tip-side="bottom"
          data-tip-align="right"
          className={`shrink-0 rounded-lg p-1.5 transition-colors pointer-coarse:min-h-11 ${
            showing === "stage"
              ? "text-accent"
              : "text-faint hover:bg-raised hover:text-accent"
          }`}
        >
          {showing === "stage" ? (
            <Video className="size-4" aria-hidden="true" />
          ) : (
            <Scan className="size-4" aria-hidden="true" />
          )}
        </button>
      </header>
      <div className="relative flex min-h-0 flex-1 items-center justify-center p-4">
        {hunting ? (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3">
            <Loader2
              className="size-6 animate-spin text-accent"
              aria-hidden="true"
            />
            <p className="font-mono text-[0.7rem] text-muted">
              Finding piano pattern
            </p>
          </div>
        ) : null}
        <canvas
          ref={canvas}
          width={output.width}
          height={output.height}
          onPointerDown={(event) => {
            if (showing !== "camera" || corners.current === null) {
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
