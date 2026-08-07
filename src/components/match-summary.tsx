"use client";

import { rankOf, type Summary } from "@/lib/scoring/summary";

/** The rows both sides are read across, in the order they matter. Held here so
 * the labels and the values cannot drift apart. */
const rows = [
  { key: "notes", label: "notes" },
  { key: "streak", label: "streak" },
  { key: "hold", label: "hold" },
  { key: "timing", label: "timing" },
] as const;

function readOut(summary: Summary, key: (typeof rows)[number]["key"]): string {
  if (key === "notes") {
    return `${Math.round(summary.notes * 100)}%`;
  }
  if (key === "streak") {
    return String(summary.streak);
  }
  if (key === "hold") {
    return `${Math.round(summary.hold * 100)}%`;
  }
  return `${Math.round(summary.spread * 1000)}ms`;
}

/** How a run read, side by side where there is another one to read it against.
 * The grand score leads, since it is the only thing that settles a battle, and
 * the rest is what a player can take into the next go. */
export function MatchSummary({
  mine,
  theirs,
  myName,
  theirName,
  coop,
}: {
  mine: Summary;
  theirs: Summary | null;
  myName: string;
  theirName: string;
  coop: boolean;
}) {
  const grand = coop && theirs !== null ? mine.points + theirs.points : null;
  const ahead = theirs === null ? true : mine.points >= theirs.points;

  return (
    <div className="w-full max-w-md overflow-hidden rounded-2xl border border-line-strong bg-panel">
      <div className="flex items-start justify-between gap-4 bg-gradient-to-b from-accent/10 to-transparent px-5 py-4">
        <div>
          <p className="label">{grand === null ? "score" : "band score"}</p>
          <p className="font-bold font-mono text-4xl tabular-nums">
            {(grand ?? mine.points).toLocaleString()}
          </p>
        </div>
        <div className="text-right">
          <p className="label">rank</p>
          <p className="font-bold font-mono text-3xl text-good leading-none">
            {rankOf(mine)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] border-line border-t">
        <Column
          summary={mine}
          name={myName}
          align="left"
          lit={theirs !== null && ahead}
        />
        <div className="flex flex-col gap-1 border-line border-x px-3 py-3">
          <span className="label h-7 leading-7">score</span>
          {rows.map((row) => (
            <span key={row.key} className="label h-7 leading-7">
              {row.label}
            </span>
          ))}
        </div>
        {theirs === null ? (
          <div />
        ) : (
          <Column
            summary={theirs}
            name={theirName}
            align="right"
            lit={!ahead}
          />
        )}
      </div>
    </div>
  );
}

function Column({
  summary,
  name,
  align,
  lit,
}: {
  summary: Summary;
  name: string;
  align: "left" | "right";
  lit: boolean;
}) {
  const side = align === "right" ? "items-end text-right" : "items-start";
  return (
    <div
      className={`flex flex-col gap-1 px-4 py-3 ${side} ${lit ? "bg-good/5" : ""}`}
    >
      <span className="flex h-7 items-center gap-2 font-mono text-sm tabular-nums">
        <span className="truncate text-faint text-xs">{name}</span>
        <b className="font-bold text-base">{summary.points.toLocaleString()}</b>
      </span>
      {rows.map((row) => (
        <span
          key={row.key}
          className="flex h-7 items-center font-mono text-sm tabular-nums"
        >
          {readOut(summary, row.key)}
        </span>
      ))}
    </div>
  );
}
