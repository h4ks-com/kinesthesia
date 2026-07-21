"use client";

import { type PointerEvent as ReactPointerEvent, useRef } from "react";
import {
  attackRange,
  releaseRange,
  type Voicing,
  volumeRange,
} from "@/lib/audio/voicing";

const width = 100;
const height = 40;
const floor = 36;
const ceiling = 4;
/** The attack owns the left of the curve and the release the right. What sits
 * between is the sample playing at its written length. */
const riseEnd = 34;
const fallStart = 58;
/** A handle at the end of its travel still has to be grabbable, so neither end
 * of the curve reaches the edge of the box. */
const inset = 5;

type Handle = "peak" | "tail";

type EnvelopeEditorProps = {
  voicing: Voicing;
  onChange: (voicing: Voicing) => void;
};

type Range = { readonly min: number; readonly max: number };

function share(value: number, range: Range): number {
  return (value - range.min) / (range.max - range.min);
}

function fromShare(fraction: number, range: Range): number {
  const value = range.min + fraction * (range.max - range.min);
  return Math.round(Math.min(range.max, Math.max(range.min, value)));
}

export function EnvelopeEditor({ voicing, onChange }: EnvelopeEditorProps) {
  const frame = useRef<SVGSVGElement | null>(null);
  const held = useRef<Handle | null>(null);

  const peakX = inset + share(voicing.attack, attackRange) * (riseEnd - inset);
  const peakY = floor - share(voicing.volume, volumeRange) * (floor - ceiling);
  const tailX =
    fallStart +
    share(voicing.release, releaseRange) * (width - inset - fallStart);
  const ringsOn = voicing.release === releaseRange.min;

  const grab = (event: ReactPointerEvent<SVGCircleElement>, handle: Handle) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    held.current = handle;
  };

  const move = (event: ReactPointerEvent<SVGSVGElement>) => {
    const handle = held.current;
    const box = frame.current?.getBoundingClientRect() ?? null;
    if (handle === null || box === null) {
      return;
    }
    const x = ((event.clientX - box.left) / box.width) * width;
    const y = ((event.clientY - box.top) / box.height) * height;
    if (handle === "peak") {
      onChange({
        ...voicing,
        attack: fromShare((x - inset) / (riseEnd - inset), attackRange),
        volume: fromShare((floor - y) / (floor - ceiling), volumeRange),
      });
      return;
    }
    onChange({
      ...voicing,
      release: fromShare(
        (x - fallStart) / (width - inset - fallStart),
        releaseRange,
      ),
    });
  };

  return (
    <div className="px-2 pt-1 pb-2">
      <svg
        ref={frame}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        aria-hidden="true"
        onPointerMove={move}
        onPointerUp={() => {
          held.current = null;
        }}
        onPointerCancel={() => {
          held.current = null;
        }}
        onLostPointerCapture={() => {
          held.current = null;
        }}
        className="h-20 w-full touch-none overflow-visible"
      >
        <line
          x1="0"
          y1={floor}
          x2={width}
          y2={floor}
          stroke="var(--line-strong)"
          strokeWidth="0.5"
        />
        <path
          d={`M0 ${floor} L${peakX} ${peakY} L${fallStart} ${peakY} L${tailX} ${floor} Z`}
          fill="var(--accent)"
          opacity="0.12"
        />
        <path
          d={`M0 ${floor} L${peakX} ${peakY} L${fallStart} ${peakY} L${tailX} ${floor}`}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
        {ringsOn ? (
          <line
            x1={fallStart}
            y1={peakY}
            x2={width - inset}
            y2={peakY}
            stroke="var(--accent)"
            strokeWidth="1.2"
            strokeDasharray="2 2"
            opacity="0.45"
          />
        ) : null}
        <circle
          cx={peakX}
          cy={peakY}
          r="3.2"
          fill="var(--accent)"
          className="cursor-grab active:cursor-grabbing"
          onPointerDown={(event) => grab(event, "peak")}
        />
        <circle
          cx={tailX}
          cy={ringsOn ? peakY : floor}
          r="3.2"
          fill="var(--panel)"
          stroke="var(--accent)"
          strokeWidth="1.2"
          className="cursor-grab active:cursor-grabbing"
          onPointerDown={(event) => grab(event, "tail")}
        />
      </svg>

      <div className="flex items-baseline justify-between font-mono text-[0.7rem] text-faint">
        <span
          data-tip="Attack: how long the note takes to fade in."
          data-tip-side="top"
          data-tip-align="left"
          data-tip-wide=""
        >
          {voicing.attack} ms in
        </span>
        <span
          className="text-muted"
          data-tip="Volume: how loud this track plays, as a percent of the file."
          data-tip-side="top"
          data-tip-wide=""
        >
          {voicing.volume}%
        </span>
        <span
          data-tip={
            ringsOn
              ? "Release: at the minimum the note rings for its written length."
              : "Release: how long the note rings on after the key lifts."
          }
          data-tip-side="top"
          data-tip-align="right"
          data-tip-wide=""
        >
          {ringsOn ? "rings on" : `${voicing.release} ms out`}
        </span>
      </div>

      <div className="sr-only [&:focus-within]:flex [&:focus-within]:flex-col [&:focus-within]:gap-1 [&:focus-within]:px-2 [&:focus-within]:text-xs">
        <label>
          Attack in milliseconds
          <input
            type="range"
            min={attackRange.min}
            max={attackRange.max}
            step={10}
            value={voicing.attack}
            onChange={(event) =>
              onChange({ ...voicing, attack: Number(event.target.value) })
            }
          />
        </label>
        <label>
          Release in milliseconds
          <input
            type="range"
            min={releaseRange.min}
            max={releaseRange.max}
            step={50}
            value={voicing.release}
            onChange={(event) =>
              onChange({ ...voicing, release: Number(event.target.value) })
            }
          />
        </label>
        <label>
          Volume percent
          <input
            type="range"
            min={volumeRange.min}
            max={volumeRange.max}
            step={5}
            value={voicing.volume}
            onChange={(event) =>
              onChange({ ...voicing, volume: Number(event.target.value) })
            }
          />
        </label>
      </div>
    </div>
  );
}
