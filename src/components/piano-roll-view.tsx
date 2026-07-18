"use client";

import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
} from "react";
import type { Song } from "@/lib/midi/song";
import { PianoRollRenderer } from "@/lib/render/piano-roll";

type PianoRollViewProps = {
  song: Song;
  hiddenTracks: ReadonlySet<number>;
  getPosition: () => number;
  getPressed: () => ReadonlySet<number>;
  onStrike?: (pitch: number) => void;
  onRelease?: (pitch: number) => void;
};

export function PianoRollView({
  song,
  hiddenTracks,
  getPosition,
  getPressed,
  onStrike,
  onRelease,
}: PianoRollViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<PianoRollRenderer | null>(null);
  const hiddenRef = useRef(hiddenTracks);
  hiddenRef.current = hiddenTracks;
  const held = useRef(new Map<number, number>());
  const drag = useRef<{ x: number; pan: number; moved: boolean } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    const renderer = new PianoRollRenderer(canvas);
    rendererRef.current = renderer;
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
      rendererRef.current = null;
    };
  }, [song, getPosition, getPressed]);

  function localPoint(event: ReactPointerEvent<HTMLCanvasElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  function onPointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    const renderer = rendererRef.current;
    if (renderer === null) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const { x, y } = localPoint(event);
    const pitch = renderer.pitchAt(x, y);
    if (pitch !== null && onStrike !== undefined) {
      held.current.set(event.pointerId, pitch);
      onStrike(pitch);
      return;
    }
    drag.current = { x: event.clientX, pan: renderer.panOffset, moved: false };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const renderer = rendererRef.current;
    const start = drag.current;
    if (renderer === null || start === null) {
      return;
    }
    renderer.setPan(start.pan - (event.clientX - start.x));
    start.moved = true;
  }

  function endPointer(event: ReactPointerEvent<HTMLCanvasElement>) {
    const pitch = held.current.get(event.pointerId);
    if (pitch !== undefined) {
      held.current.delete(event.pointerId);
      onRelease?.(pitch);
    }
    drag.current = null;
  }

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={`Piano roll for ${song.name}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      className="absolute inset-0 block size-full touch-none"
    />
  );
}
