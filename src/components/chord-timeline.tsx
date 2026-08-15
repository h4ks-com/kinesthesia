"use client";

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

export function ChordTimeline({ timeline, duration }: ChordTimelineProps) {
  if (timeline.length === 0 || duration <= 0) {
    return <p className="text-faint text-xs">No chords detected.</p>;
  }

  const segments = segmentsOf(timeline, duration);

  return (
    <div>
      <div
        aria-hidden="true"
        className="flex h-8 w-full overflow-hidden rounded-md border border-line-strong"
      >
        {segments.map((segment) => {
          const share = (segment.end - segment.start) / duration;
          return (
            <div
              key={segment.start}
              data-tip={`${segment.chord ?? "Silence"} · ${formatClock(segment.start)}–${formatClock(segment.end)}`}
              style={{
                flexGrow: Math.max(segment.end - segment.start, 0.001),
                flexBasis: 0,
                background:
                  segment.root === null
                    ? "var(--color-raised)"
                    : `color-mix(in srgb, ${pitchColor(segment.root)} 38%, var(--color-raised))`,
              }}
              className="flex min-w-0 items-center justify-center px-1 transition-[filter] duration-150 hover:z-10 hover:brightness-125"
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
      <div className="mt-1 flex justify-between font-mono text-[0.65rem] text-faint">
        <span>0:00</span>
        <span>{formatClock(duration)}</span>
      </div>
      <ol className="sr-only">
        {segments.map((segment) => (
          <li key={segment.start}>
            {segment.chord ?? "Silence"}, {formatClock(segment.start)} to{" "}
            {formatClock(segment.end)}
          </li>
        ))}
      </ol>
    </div>
  );
}
