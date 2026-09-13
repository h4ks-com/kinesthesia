"use client";

import { type LeadCell, leadCell, leadShare } from "@/lib/scoring/lead";

/** Your end to theirs, one colour per cell. */
const ramp: Readonly<Record<LeadCell, string>> = {
  0: "var(--color-good)",
  1: "color-mix(in srgb, var(--color-good) 55%, var(--color-warn))",
  2: "var(--color-warn)",
  3: "color-mix(in srgb, var(--color-warn) 45%, var(--color-danger))",
  4: "var(--color-danger)",
};

const cells: readonly LeadCell[] = [0, 1, 2, 3, 4];

/** Which way a battle is going, in five cells and the gap in points. The lit
 * cell walks toward your end as you pull ahead. Each side works it out from
 * where it sits, so your own end is always the green one. */
export function LeadMeter({ mine, theirs }: { mine: number; theirs: number }) {
  const live = leadCell(leadShare(mine, theirs));
  const gap = mine - theirs;

  return (
    <div
      aria-hidden="true"
      data-lead=""
      // top-16 clears the h-14 header each half opens with.
      className="-translate-x-1/2 pointer-events-none absolute top-16 left-1/2 z-20 flex flex-col items-center gap-1 rounded-xl border border-line-strong bg-panel/85 px-2 py-1.5 backdrop-blur"
    >
      <span className="flex gap-[3px]">
        {cells.map((cell) => (
          <span
            key={cell}
            data-lit={cell === live ? "" : null}
            className="h-2 w-[13px] rounded-sm border border-line-strong transition-[background,box-shadow,border-color] duration-200"
            style={
              cell === live
                ? {
                    background: ramp[cell],
                    borderColor: ramp[cell],
                    boxShadow: `0 0 9px color-mix(in srgb, ${ramp[cell]} 60%, transparent)`,
                  }
                : {
                    background: `color-mix(in srgb, ${ramp[cell]} 14%, var(--color-raised))`,
                  }
            }
          />
        ))}
      </span>
      <span
        className="font-bold font-mono text-[11px] leading-none tabular-nums"
        style={{ color: ramp[live] }}
      >
        {gap === 0 ? "0" : `${gap > 0 ? "+" : "−"}${Math.abs(gap)}`}
      </span>
    </div>
  );
}
