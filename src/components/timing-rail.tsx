"use client";

import { useEffect, useRef, useState } from "react";
import { goodBand, perfectBand, railMean, railPlace } from "@/lib/scoring/rail";
import type { Hit } from "@/lib/scoring/use-gates";

/** How many strikes the rail remembers. Enough to read a habit from, few enough
 * that fixing one stops being held against you. */
const kept = 24;
/** How long a tick stays before it starts going. */
const linger = 1600;

type Mark = { readonly seq: number; readonly away: number };

export type RailLie = "upright" | "flat";

/** Where each strike landed against the beat, along the line that divides the
 * players. Upright while the rolls sit side by side, flat once they stack, so
 * it never crosses the layout. Upright it also reads the way the notes travel:
 * a strike above the line came early, one below it came late. */
export function TimingRail({ hit, lie }: { hit: Hit | null; lie: RailLie }) {
  const [marks, setMarks] = useState<readonly Mark[]>([]);
  const seen = useRef(0);
  /** Every mark's own timer, held together rather than returned as this
   * effect's cleanup: a new strike runs the last one's cleanup, which would
   * cancel the removal of the mark before it and leave it on the rail. */
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(
    () => () => {
      for (const timer of timers.current) {
        clearTimeout(timer);
      }
      timers.current = [];
    },
    [],
  );

  useEffect(() => {
    if (hit === null || hit.seq === seen.current || hit.away === null) {
      return;
    }
    seen.current = hit.seq;
    const mark = { seq: hit.seq, away: hit.away };
    setMarks((current) => [...current, mark].slice(-kept));
    timers.current.push(
      setTimeout(() => {
        setMarks((current) => current.filter((old) => old.seq !== mark.seq));
      }, linger),
    );
  }, [hit]);

  if (marks.length === 0) {
    return null;
  }

  const upright = lie === "upright";
  const mean = railMean(marks.map((mark) => mark.away));
  const along = (fraction: number): string => `${fraction * 100}%`;
  const band = (width: number): React.CSSProperties =>
    upright
      ? { top: along((1 - width) / 2), height: along(width) }
      : { left: along((1 - width) / 2), width: along(width) };

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute z-10 rounded-full border border-line-strong bg-void/70 backdrop-blur-sm ${
        upright
          ? "top-[14%] right-1.5 bottom-[14%] w-2.5"
          : "right-[14%] bottom-1.5 left-[14%] h-2.5"
      }`}
    >
      <span className="absolute inset-0 rounded-full bg-danger/25" />
      <span
        className={`absolute rounded-full bg-warn/30 ${upright ? "inset-x-0" : "inset-y-0"}`}
        style={band(goodBand)}
      />
      <span
        className={`absolute rounded-full bg-good/40 ${upright ? "inset-x-0" : "inset-y-0"}`}
        style={band(perfectBand)}
      />
      <span
        className={`absolute bg-text/70 ${upright ? "-inset-x-1 top-1/2 h-px" : "-inset-y-1 left-1/2 w-px"}`}
      />

      {marks.map((mark) => (
        <span
          key={mark.seq}
          className={`fade-out absolute rounded-sm bg-text ${upright ? "inset-x-[3px] h-[3px]" : "inset-y-[3px] w-[3px]"}`}
          style={
            upright
              ? { top: along(railPlace(mark.away)) }
              : { left: along(railPlace(mark.away)) }
          }
        />
      ))}

      {mean === null ? null : (
        <span
          className={`absolute bg-accent shadow-[0_0_6px_var(--color-accent)] transition-[top,left] duration-300 ${
            upright ? "-inset-x-[5px] h-0.5" : "-inset-y-[5px] w-0.5"
          }`}
          style={
            upright
              ? { top: along(railPlace(mean)) }
              : { left: along(railPlace(mean)) }
          }
        />
      )}
    </div>
  );
}
