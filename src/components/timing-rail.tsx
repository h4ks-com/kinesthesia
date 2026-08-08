"use client";

import { useEffect, useRef, useState } from "react";
import { keyboardHeightRatio, maxKeyboardHeight } from "@/lib/render/keyboard";
import {
  goodBand,
  perfectBand,
  railMean,
  railPlace,
  strikesRemembered,
} from "@/lib/scoring/rail";
import type { Hit } from "@/lib/scoring/use-gates";

/** How long a reading stands on the rail before it goes. */
const linger = 1500;

/** How faint the oldest reading on a crowded rail is allowed to go. */
const faintest = 0.18;

/** The stretch the rail stands in: under the chrome, and clear of the keys the
 * roll draws over the foot of the same box. Taken from what the keybed is
 * actually given so the two cannot drift apart, and shared so anything meant to
 * line up with the rail is measured against the rail itself. */
export const railInset = {
  top: "0.75rem",
  bottom: `calc(min(${maxKeyboardHeight}px, ${keyboardHeightRatio * 100}%) + 0.75rem)`,
} as const;

type Mark = { readonly seq: number; readonly away: number };

/** Where each strike landed against the beat, beside the notes and reading the
 * way they travel: a strike above the line came early, one below it came late.
 * Standing whether or not anything has been struck, so the bands are somewhere
 * a player already knows to look. */
export function TimingRail({ hit }: { hit: Hit | null }) {
  const [marks, setMarks] = useState<readonly Mark[]>([]);
  const seen = useRef(0);
  /** Each mark's own removal, kept apart from the effect that made it: the next
   * strike must not cancel what is already standing there. */
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    if (hit === null || hit.seq === seen.current || hit.away === null) {
      return;
    }
    const { seq, away } = hit;
    seen.current = seq;
    setMarks((current) =>
      [...current, { seq, away }].slice(-strikesRemembered),
    );
    timers.current.set(
      seq,
      setTimeout(() => {
        timers.current.delete(seq);
        setMarks((current) => current.filter((mark) => mark.seq !== seq));
      }, linger),
    );
  }, [hit]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) {
        clearTimeout(timer);
      }
      pending.clear();
    };
  }, []);

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
      className="pointer-events-none absolute right-1.5 z-10 w-2.5 rounded-full border border-line-strong bg-void/70 backdrop-blur-sm"
      style={railInset}
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
          data-tick=""
          className="-inset-x-[3px] absolute h-[5px] rounded-full bg-text shadow-[0_0_0_1px_var(--color-void)] transition-opacity duration-[400ms] ease-out"
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
