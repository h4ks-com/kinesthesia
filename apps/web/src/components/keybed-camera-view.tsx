"use client";

import { useEffect, useRef, useState } from "react";
import { defaultFade, drawCameraLayer } from "@/lib/vision/compose";
import { createKeybedCamera, type Sighting } from "@/lib/vision/keybed-camera";
import { placeKeybed } from "@/lib/vision/placement";

const output = { width: 1280, height: 720 };

/** What the page says while nothing is drawn, so a black screen is never a
 * mystery. */
function statusOf(sighting: Sighting, ready: boolean): string {
  if (!ready) {
    return "starting the camera";
  }
  return sighting.found ? "" : sighting.reason;
}

export function KeybedCameraView() {
  const video = useRef<HTMLVideoElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("starting the camera");
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
      setReady(true);

      // The model and its runtime are megabytes, and nothing outside this page
      // wants them, so they arrive only once a camera is running.
      const { createKeybedCamera } = await import("@/lib/vision/keybed-camera");
      const camera = await createKeybedCamera();
      const context = canvas.current?.getContext("2d") ?? null;

      const draw = (now: number): void => {
        frame = requestAnimationFrame(draw);
        if (context === null || element.videoWidth === 0) {
          return;
        }
        void camera.look(element, now);
        const sighting = camera.sighting();
        setStatus(statusOf(sighting, true));
        context.fillStyle = "#07080b";
        context.fillRect(0, 0, output.width, output.height);
        if (!sighting.found) {
          return;
        }
        const size = {
          width: element.videoWidth,
          height: element.videoHeight,
        };
        drawCameraLayer(
          context,
          element,
          size,
          placeKeybed(sighting.keybed, size, output),
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

  return (
    <div className="flex h-dvh flex-col bg-void">
      <header className="flex items-center gap-3 border-line border-b px-4 py-3">
        <h1 className="label">keybed camera</h1>
        <p className="font-mono text-[0.7rem] text-faint">
          {refused ?? status}
        </p>
      </header>
      <div className="relative flex min-h-0 flex-1 items-center justify-center p-4">
        <canvas
          ref={canvas}
          width={output.width}
          height={output.height}
          className="max-h-full max-w-full rounded-xl border border-line"
        />
        {/* The camera feeds the canvas and is never shown on its own: the room
            and the player stay off screen. */}
        <video ref={video} className="hidden" muted playsInline />
      </div>
    </div>
  );
}
