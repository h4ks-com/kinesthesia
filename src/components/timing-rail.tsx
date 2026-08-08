"use client";

import { useEffect, useRef, useState } from "react";
import {
  goodBand,
  perfectBand,
  railMean,
  railPlace,
  strikesRemembered,
} from "@/lib/scoring/rail";
import type { Hit } from "@/lib/scoring/use-gates";

/** How long the whole rail takes to empty once nothing more is struck. Each
 * reading holds a share of it, so a lone tick waits the full time and a busy
 * rail turns over quickly. */
const linger = 1500;

/** How faint the oldest reading on a crowded rail is allowed to go. */
const faintest = 0.18;

type Mark = { readonly seq: number; readonly away: number };

/** Where each strike landed against the beat, along the line that divides the
 * players. Upright while the rolls sit side by side, flat once they stack, so
 * it never crosses the layout. Upright it also reads the way the notes travel:
 * a strike above the line came early, one below it came late. */
export function TimingRail({ hit }: { hit: Hit | null }) {
  const [marks, setMarks] = useState<readonly Mark[]>([]);
  const seen = useRef(0);

  useEffect(() => {
    if (hit === null || hit.seq === seen.current || hit.away === null) {
      return;
    }
    seen.current = hit.seq;
    const mark = { seq: hit.seq, away: hit.away };
    setMarks((current) => [...current, mark].slice(-strikesRemembered));
  }, [hit]);

  /** Every live mark is re-armed together whenever the rail changes, so a
   * strike shortens what is already standing there rather than cancelling the
   * removal of anything but itself. */
  useEffect(() => {
    const timers = marks.map((mark, rank) =>
      setTimeout(
        () => {
          setMarks((current) => current.filter((old) => old.seq !== mark.seq));
        },
        (linger * (rank + 1)) / marks.length,
      ),
    );
    return () => {
      for (const timer of timers) {
        clearTimeout(timer);
      }
    };
  }, [marks]);

  if (marks.length === 0) {
    return null;
  }

  const mean = railMean(marks.map((mark) => mark.away));
  const along = (fraction: number): string => `${fraction * 100}%`;
  const band = (width: number): React.CSSProperties => ({
    top: along((1 - width) / 2),
    height: along(width),
  });

  return (
    <div
      aria-hidden="true"
      data-rail=""
      className="pointer-events-none absolute top-[14%] right-1.5 bottom-[14%] z-10 w-2.5 rounded-full border border-line-strong bg-void/70 backdrop-blur-sm"
    >
      <span className="absolute inset-0 rounded-full bg-danger/25" />
      <span
        className="absolute inset-x-0 rounded-full bg-warn/30"
        style={band(goodBand)}
      />
      <span
        className="absolute inset-x-0 rounded-full bg-good/40"
        style={band(perfectBand)}
      />
      <span className="absolute inset-x-0 top-1/2 h-px bg-text/20" />

      {marks.map((mark, rank) => (
        <span
          key={mark.seq}
          className="fade-out -inset-x-[3px] absolute h-[5px] rounded-full bg-text shadow-[0_0_0_1px_var(--color-void)]"
          style={{
            opacity: faintest + (1 - faintest) * ((rank + 1) / marks.length),
            top: along(railPlace(mark.away)),
          }}
        />
      ))}

      {mean === null ? null : (
        <span
          className="-inset-x-[5px] absolute h-0.5 bg-accent shadow-[0_0_6px_var(--color-accent)] transition-[top] duration-300"
          style={{ top: along(railPlace(mean)) }}
        />
      )}
    </div>
  );
}
