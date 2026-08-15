"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatClock } from "@/lib/format/clock";
import type { Song } from "@/lib/midi/song";
import { drawSongMap, pitchSpan } from "@/lib/render/minimap";

/** Fine enough that dragging reads as continuous rather than stepping from one
 * second to the next, which is what this replaced. */
const seekStep = 0.05;

/** A keyboard gets its own distances, because one step of the drag resolution
 * per press would take twenty presses to cross a second. */
const keySteps: Readonly<Record<string, number>> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowDown: -1,
  ArrowUp: 1,
  PageDown: -10,
  PageUp: 10,
};

type SongMinimapProps = {
  song: Song;
  hiddenTracks: ReadonlySet<number>;
  /** For the range underneath, which is the thing a screen reader and a keyboard
   * operate. The playhead runs off the clock instead, because a position held in
   * React state can only move as often as the component re-renders. */
  elapsed: number;
  getPosition: () => number;
  onSeek: ((position: number) => void) | null;
};

/** The song drawn twice over, played and unplayed. Both are made once and the
 * lit one is revealed as far as the playhead, so moving it costs one style
 * write rather than a redraw of every note. */
type Layers = { readonly dim: string; readonly lit: string };

function paint(
  song: Song,
  hiddenTracks: ReadonlySet<number>,
  width: number,
  height: number,
): Layers | null {
  const canvas = document.createElement("canvas");
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.max(1, Math.floor(width * ratio));
  canvas.height = Math.max(1, Math.floor(height * ratio));
  const ctx = canvas.getContext("2d");
  if (ctx === null) {
    return null;
  }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  const span = pitchSpan(song);
  const layer = (lit: boolean): string => {
    drawSongMap(ctx, { song, span, hiddenTracks, width, height, lit });
    return canvas.toDataURL();
  };
  return { dim: layer(false), lit: layer(true) };
}

export function SongMinimap({
  song,
  hiddenTracks,
  elapsed,
  getPosition,
  onSeek,
}: SongMinimapProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const litRef = useRef<HTMLDivElement | null>(null);
  const headRef = useRef<HTMLDivElement | null>(null);
  const widthRef = useRef(0);
  const [layers, setLayers] = useState<Layers | null>(null);
  const duration = Math.max(song.duration, 0.001);
  /** A set is a new object on every render upstream, so what it holds is what
   * says the picture is out of date, and the picture is redrawn from this
   * rather than from the set it came from. */
  const hiddenKey = useMemo(
    () => [...hiddenTracks].sort((one, next) => one - next).join(","),
    [hiddenTracks],
  );

  useEffect(() => {
    const frame = frameRef.current;
    if (frame === null) {
      return;
    }
    const hidden = new Set(
      hiddenKey === "" ? [] : hiddenKey.split(",").map(Number),
    );
    // Both start empty on every run of this effect, so a change of song or of
    // what is shown repaints even though the element has not been resized.
    let width = 0;
    let height = 0;
    const measure = (): void => {
      const box = frame.getBoundingClientRect();
      if (box.width < 1 || (box.width === width && box.height === height)) {
        return;
      }
      width = box.width;
      height = box.height;
      widthRef.current = width;
      setLayers(paint(song, hidden, width, height));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [song, hiddenKey]);

  useEffect(() => {
    // Moved by writing two styles a frame rather than by re-rendering, so the
    // playhead travels on the audio clock at the refresh rate of the screen.
    let frame = requestAnimationFrame(function loop() {
      const share = Math.max(0, Math.min(1, getPosition() / duration));
      const lit = litRef.current;
      const head = headRef.current;
      if (lit !== null) {
        lit.style.clipPath = `inset(0 ${(1 - share) * 100}% 0 0)`;
      }
      if (head !== null) {
        head.style.transform = `translateX(${share * widthRef.current}px)`;
      }
      frame = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(frame);
  }, [duration, getPosition]);

  const cover = { backgroundSize: "100% 100%", backgroundRepeat: "no-repeat" };

  return (
    <div
      ref={frameRef}
      className={`relative h-9 min-w-0 flex-1 overflow-hidden rounded-md bg-raised ring-accent has-[:focus-visible]:ring-2 ${
        onSeek === null ? "opacity-50" : ""
      }`}
    >
      {layers === null ? null : (
        <>
          <div
            aria-hidden="true"
            style={{ ...cover, backgroundImage: `url(${layers.dim})` }}
            className="absolute inset-0"
          />
          <div
            ref={litRef}
            aria-hidden="true"
            style={{ ...cover, backgroundImage: `url(${layers.lit})` }}
            className="absolute inset-0"
          />
        </>
      )}
      <div
        ref={headRef}
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-0.5 bg-accent shadow-[0_0_6px_var(--accent)]"
      />
      {/* A real range carries the semantics, the keyboard and the drag; the map
          is drawn behind it. A div given a slider role is operable by neither a
          screen reader nor an arrow key without rebuilding both by hand. */}
      <input
        type="range"
        min={0}
        max={Math.max(1, duration)}
        step={seekStep}
        value={Math.min(elapsed, duration)}
        disabled={onSeek === null}
        onChange={(event) => onSeek?.(Number(event.target.value))}
        onKeyDown={(event) => {
          if (onSeek === null) {
            return;
          }
          const step = keySteps[event.key];
          const target =
            step === undefined
              ? { Home: 0, End: duration }[event.key]
              : getPosition() + step;
          if (target === undefined) {
            return;
          }
          event.preventDefault();
          onSeek(Math.max(0, Math.min(duration, target)));
        }}
        aria-label="Song position"
        aria-valuetext={formatClock(elapsed)}
        className="absolute inset-0 size-full cursor-pointer appearance-none bg-transparent opacity-0 outline-none disabled:cursor-default"
      />
    </div>
  );
}
