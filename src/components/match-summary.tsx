"use client";

import { rankOf, type Summary } from "@/lib/scoring/summary";

/** The rows both sides are read across, in the order they matter. Each carries
 * how it reads itself, so a row added here cannot arrive without a value or
 * quietly borrow the one below it. */
const rows = [
  {
    label: "notes",
    tip: "The share of the notes asked of you that you answered at all, however near the beat you landed.",
    read: (run: Summary) => `${Math.round(run.notes * 100)}%`,
  },
  {
    label: "streak",
    tip: "The longest run of notes you answered without missing one.",
    read: (run: Summary) => String(run.streak),
  },
  {
    label: "timing",
    tip: "How far from the beat a note landed on average, counting early and late alike. The number that comes down with practice.",
    read: (run: Summary) => `${Math.round(run.spread * 1000)}ms`,
  },
] as const;

const scoreTip =
  "100 for a note on the beat, 50 for a near one, 10 a note for your longest streak, and 40 a second for every note you kept down.";

const rankTip =
  "Awarded on the notes you answered and how near the beat they landed, both at once, so neither one carries the other.";

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
  const ahead = theirs !== null && mine.points >= theirs.points;

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
          <p
            className="label cursor-help"
            data-tip={rankTip}
            data-tip-wide=""
            data-tip-align="right"
          >
            rank
          </p>
          <p className="font-bold font-mono text-3xl text-good leading-none">
            {rankOf(mine)}
          </p>
        </div>
      </div>

      <TimingShape mine={mine.shape} theirs={theirs?.shape ?? null} />

      <div className="grid grid-cols-[1fr_auto_1fr] border-line border-t">
        <Column summary={mine} name={myName} align="left" lit={ahead} />
        {/* The explanations open upward: the card clips what leaves it, and
            every label but the first has the foot of the card just below. */}
        <div className="flex flex-col gap-1 border-line border-x px-3 py-3">
          <span
            className="label h-7 cursor-help leading-7"
            data-tip={scoreTip}
            data-tip-wide=""
            data-tip-side="top"
          >
            score
          </span>
          {rows.map((row) => (
            <span
              key={row.label}
              className="label h-7 cursor-help leading-7"
              data-tip={row.tip}
              data-tip-wide=""
              data-tip-side="top"
            >
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

/** The run's timing as a curve: a lump under the middle is a player landing on
 * the beat, and one sitting off to a side is a habit worth telling them about.
 * Drawn as a smooth path rather than bars, since the shape is the reading and
 * the exact column counts are not. */
function TimingShape({
  mine,
  theirs,
}: {
  mine: readonly number[];
  theirs: readonly number[] | null;
}) {
  const most = Math.max(1, ...mine, ...(theirs ?? []));
  if (most === 1 && mine.every((count) => count === 0)) {
    return null;
  }
  return (
    <div className="border-line border-t px-5 py-4">
      <p className="label mb-1.5">where your notes landed</p>
      <svg
        viewBox="0 0 300 60"
        preserveAspectRatio="none"
        className="block h-16 w-full"
        aria-hidden="true"
      >
        <title>Timing distribution</title>
        <line
          x1="150"
          y1="0"
          x2="150"
          y2="60"
          stroke="currentColor"
          strokeOpacity="0.25"
          strokeDasharray="3 4"
          className="text-text"
        />
        {theirs === null ? null : (
          <path
            d={curve(theirs, most)}
            className="fill-warn/15 stroke-warn/50"
            strokeWidth="1.5"
          />
        )}
        <path
          d={curve(mine, most)}
          className="fill-accent/20 stroke-accent"
          strokeWidth="2"
        />
      </svg>
      <p className="flex justify-between font-mono text-[10px] text-faint">
        <span>early</span>
        <span>on the beat</span>
        <span>late</span>
      </p>
      {theirs === null ? null : (
        <p className="mt-1.5 flex gap-3 font-mono text-[10px]">
          <span className="flex items-center gap-1 text-accent">
            <span className="h-0.5 w-3 rounded-full bg-accent" />
            you
          </span>
          <span className="flex items-center gap-1 text-warn">
            <span className="h-0.5 w-3 rounded-full bg-warn" />
            opponent
          </span>
        </p>
      )}
    </div>
  );
}

/** A path through the column tops, eased so the counts read as one shape. */
function curve(shape: readonly number[], most: number): string {
  const step = 300 / Math.max(1, shape.length - 1);
  const points = shape.map((count, index) => ({
    x: index * step,
    y: 58 - (count / most) * 52,
  }));
  let path = `M0,60 L${points[0]?.x ?? 0},${points[0]?.y ?? 58}`;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    if (from === undefined || to === undefined) {
      continue;
    }
    const middle = (from.x + to.x) / 2;
    path += ` C${middle},${from.y} ${middle},${to.y} ${to.x},${to.y}`;
  }
  return `${path} L300,60 Z`;
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
          key={row.label}
          className="flex h-7 items-center font-mono text-sm tabular-nums"
        >
          {row.read(summary)}
        </span>
      ))}
    </div>
  );
}
