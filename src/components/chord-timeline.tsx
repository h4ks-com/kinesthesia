"use client";

import { useState } from "react";
import { Chord, Note } from "tonal";
import { formatClock } from "@/lib/format/clock";
import type { TimelineChord } from "@/lib/midi/analysis";
import { pitchColor } from "@/lib/midi/palette";

type ChordTimelineProps = {
  /** Chord-change points in seconds, ascending. */
  timeline: readonly TimelineChord[];
  duration: number;
};

type Segment = {
  readonly chord: string | null;
  readonly root: number | null;
  readonly start: number;
  readonly end: number;
};

/** A segment prints its name once it holds this share of the timeline or more;
 * narrower than that, the label would overlap its neighbours, so it keeps only
 * its colour and answers a hover or the list below instead. */
const labelShare = 0.06;

function rootOf(chord: string): number | null {
  const tonic = Chord.get(chord).tonic;
  if (tonic === null) {
    return null;
  }
  const chroma = Note.chroma(tonic);
  return Number.isNaN(chroma) ? null : chroma;
}

function segmentsOf(
  timeline: readonly TimelineChord[],
  duration: number,
): Segment[] {
  return timeline.map((point, index) => {
    const end = Math.max(point.at, timeline[index + 1]?.at ?? duration);
    return {
      chord: point.chord,
      root: point.chord === null ? null : rootOf(point.chord),
      start: point.at,
      end,
    };
  });
}

function chordId(index: number): string {
  return `chord-${index}`;
}

export function ChordTimeline({ timeline, duration }: ChordTimelineProps) {
  /** Which chord is being read, by the pointer or by the arrow keys. */
  const [held, setHeld] = useState<number | null>(null);

  if (timeline.length === 0 || duration <= 0) {
    return <p className="text-faint text-xs">No chords detected.</p>;
  }

  const segments = segmentsOf(timeline, duration);
  const reading = held === null ? null : segments[held];

  return (
    <div>
      {/* One stop rather than one per chord: a progression runs to dozens of
          them, and tabbing through every one to read a name is worse than not
          reaching them at all. */}
      <div
        role="listbox"
        aria-label="Chord progression"
        aria-activedescendant={held === null ? undefined : chordId(held)}
        tabIndex={0}
        onKeyDown={(event) => {
          const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
          const jump = { Home: 0, End: segments.length - 1 }[event.key];
          const next =
            step === undefined ? jump : Math.max(0, (held ?? -1) + step);
          if (next === undefined) {
            return;
          }
          event.preventDefault();
          setHeld(Math.min(segments.length - 1, next));
        }}
        onBlur={() => setHeld(null)}
        onPointerLeave={() => setHeld(null)}
        className="flex h-8 w-full overflow-hidden rounded-md border border-line-strong outline-none ring-accent focus-visible:ring-2"
      >
        {segments.map((segment, index) => {
          const share = (segment.end - segment.start) / duration;
          return (
            <div
              key={segment.start}
              id={chordId(index)}
              role="option"
              tabIndex={-1}
              aria-selected={held === index}
              aria-label={`${segment.chord ?? "Silence"}, ${formatClock(segment.start)} to ${formatClock(segment.end)}`}
              onPointerEnter={() => setHeld(index)}
              style={{
                flexGrow: Math.max(segment.end - segment.start, 0.001),
                flexBasis: 0,
                background:
                  segment.root === null
                    ? "var(--color-raised)"
                    : `color-mix(in srgb, ${pitchColor(segment.root)} 38%, var(--color-raised))`,
              }}
              className={`flex min-w-0 items-center justify-center px-1 transition-[filter] duration-150 ${
                held === index ? "z-10 brightness-150" : ""
              }`}
            >
              {share < labelShare ? null : (
                <span className="truncate font-mono text-[0.65rem] text-text">
                  {segment.chord ?? ""}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {/* Shown here rather than in a tooltip, which only a pointer reaches: a
          crowded stretch carries no printed name, so this is the only way to
          read one without a mouse. */}
      <div
        aria-live="polite"
        className="mt-1 flex justify-between gap-2 font-mono text-[0.65rem] text-faint"
      >
        {reading === undefined || reading === null ? (
          <>
            <span>0:00</span>
            <span>{formatClock(duration)}</span>
          </>
        ) : (
          <>
            <span className="truncate text-text">
              {reading.chord ?? "Silence"}
            </span>
            <span className="shrink-0">
              {formatClock(reading.start)} to {formatClock(reading.end)}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
