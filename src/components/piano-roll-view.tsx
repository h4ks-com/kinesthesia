"use client";

import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
} from "react";
import type { Song } from "@/lib/midi/song";
import { PianoRollRenderer } from "@/lib/render/piano-roll";

/** Each pointer keeps its own gesture, so one finger panning the roll and
 * another walking the keys never read each other's start position. */
type Gesture =
  | { readonly kind: "keys"; pitch: number | null }
  | { readonly kind: "pan"; readonly x: number; readonly pan: number };

type PianoRollViewProps = {
  song: Song;
  hiddenTracks: ReadonlySet<number>;
  keyWidth: number;
  getPosition: () => number;
  getPressed: () => ReadonlySet<number>;
  getOwed: () => ReadonlySet<number>;
  getYours: () => ReadonlySet<number> | null;
  onStrike?: (pitch: number) => void;
  onRelease?: (pitch: number) => void;
};

export function PianoRollView({
  song,
  hiddenTracks,
  keyWidth,
  getPosition,
  getPressed,
  getOwed,
  getYours,
  onStrike,
  onRelease,
}: PianoRollViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<PianoRollRenderer | null>(null);
  const hiddenRef = useRef(hiddenTracks);
  hiddenRef.current = hiddenTracks;
  const keyWidthRef = useRef(keyWidth);
  keyWidthRef.current = keyWidth;
  const gestures = useRef(new Map<number, Gesture>());

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    const renderer = new PianoRollRenderer(canvas, keyWidthRef.current);
    rendererRef.current = renderer;
    let frame = requestAnimationFrame(function loop() {
      renderer.draw({
        song,
        position: getPosition(),
        hiddenTracks: hiddenRef.current,
        pressed: getPressed(),
        owed: getOwed(),
        yours: getYours(),
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
  }, [song, getPosition, getPressed, getOwed, getYours]);

  useEffect(() => {
    rendererRef.current?.setKeyWidth(keyWidth);
  }, [keyWidth]);

  /** Another finger may be holding the same key, and the pressed set is keyed
   * by pitch, so the note ends only once the last of them lifts. */
  function releasePitch(pointerId: number, pitch: number | null) {
    if (pitch === null) {
      return;
    }
    for (const [other, gesture] of gestures.current) {
      if (
        other !== pointerId &&
        gesture.kind === "keys" &&
        gesture.pitch === pitch
      ) {
        return;
      }
    }
    onRelease?.(pitch);
  }

  function pitchUnder(event: ReactPointerEvent<HTMLCanvasElement>) {
    const renderer = rendererRef.current;
    if (renderer === null) {
      return null;
    }
    const box = event.currentTarget.getBoundingClientRect();
    return renderer.pitchAt(event.clientX - box.left, event.clientY - box.top);
  }

  function onPointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    const renderer = rendererRef.current;
    if (renderer === null) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const pitch = pitchUnder(event);
    if (pitch !== null && onStrike !== undefined) {
      gestures.current.set(event.pointerId, { kind: "keys", pitch });
      onStrike(pitch);
      return;
    }
    gestures.current.set(event.pointerId, {
      kind: "pan",
      x: event.clientX,
      pan: renderer.panOffset,
    });
  }

  /** A finger that started on the keys plays every key it crosses and never
   * pans, even while it is off the keyboard between two of them. */
  function onPointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const renderer = rendererRef.current;
    const gesture = gestures.current.get(event.pointerId);
    if (renderer === null || gesture === undefined) {
      return;
    }
    if (gesture.kind === "pan") {
      renderer.setPan(gesture.pan - (event.clientX - gesture.x));
      return;
    }
    const pitch = pitchUnder(event);
    if (pitch === gesture.pitch) {
      return;
    }
    const previous = gesture.pitch;
    gesture.pitch = pitch;
    releasePitch(event.pointerId, previous);
    if (pitch !== null) {
      onStrike?.(pitch);
    }
  }

  function endPointer(event: ReactPointerEvent<HTMLCanvasElement>) {
    const gesture = gestures.current.get(event.pointerId);
    gestures.current.delete(event.pointerId);
    if (gesture?.kind === "keys") {
      releasePitch(event.pointerId, gesture.pitch);
    }
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
