"use client";

import { useEffect, useRef } from "react";
import type { Song } from "@/lib/midi/song";
import { PianoRollRenderer } from "@/lib/render/piano-roll";

type PianoRollViewProps = {
  song: Song;
  hiddenTracks: ReadonlySet<number>;
  getPosition: () => number;
  getPressed: () => ReadonlySet<number>;
};

export function PianoRollView({
  song,
  hiddenTracks,
  getPosition,
  getPressed,
}: PianoRollViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hiddenRef = useRef(hiddenTracks);
  hiddenRef.current = hiddenTracks;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    const renderer = new PianoRollRenderer(canvas);
    let frame = requestAnimationFrame(function loop() {
      renderer.draw({
        song,
        position: getPosition(),
        hiddenTracks: hiddenRef.current,
        pressed: getPressed(),
      });
      frame = requestAnimationFrame(loop);
    });

    const observer = new ResizeObserver(() => renderer.resize());
    observer.observe(canvas);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [song, getPosition, getPressed]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 block size-full"
      aria-label={`Piano roll for ${song.name}`}
    />
  );
}
