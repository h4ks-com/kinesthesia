"use client";

import { MatchSummary } from "@/components/match-summary";
import { battleOutcome } from "@/lib/multiplayer/protocol";
import type { Summary } from "@/lib/scoring/summary";

/** Play never pauses, so a connected match walks from ready, through a shared
 * countdown, to a result. */
export type Phase = "ready" | "countdown" | "playing" | "result";

export type MatchOverlayProps = {
  phase: Phase;
  count: number;
  songReady: boolean;
  myReady: boolean;
  myPoints: number;
  theirPoints: number;
  /** Null where the run has not ended, and on the other side where an older
   * build finished without sending one. */
  mySummary: Summary | null;
  theirSummary: Summary | null;
  opponentName: string;
  coop: boolean;
  opponentReady: boolean;
  opponentDone: boolean;
  opponentGone: boolean;
  myRematch: boolean;
  theirRematch: boolean;
  onReady: () => void;
  onRematch: () => void;
};

export function MatchOverlay({
  phase,
  count,
  songReady,
  myReady,
  myPoints,
  theirPoints,
  mySummary,
  theirSummary,
  opponentName,
  coop,
  opponentReady,
  opponentDone,
  opponentGone,
  myRematch,
  theirRematch,
  onReady,
  onRematch,
}: MatchOverlayProps) {
  // A departure ends the match in any phase, so it is checked before play hides
  // the overlay, and the only way on is out.
  if (opponentGone) {
    return (
      <Scrim label="The other player left">
        <div className="flex flex-col items-center gap-4">
          <h2 className="font-bold text-3xl">The other player left</h2>
          <LeaveLink />
        </div>
      </Scrim>
    );
  }

  if (phase === "playing") {
    return null;
  }

  if (phase === "countdown") {
    return (
      <Scrim label={`Starting in ${count}`}>
        <span
          className="font-bold text-7xl text-accent tabular-nums"
          aria-hidden="true"
        >
          {count}
        </span>
      </Scrim>
    );
  }

  if (phase === "ready") {
    return (
      <Scrim label="Get ready">
        <div className="flex flex-col items-center gap-4">
          {myReady ? (
            <p className="text-muted text-sm">
              {opponentReady ? "Starting…" : "Waiting for the other player"}
            </p>
          ) : songReady ? (
            <button
              type="button"
              onClick={onReady}
              className="rounded-full bg-accent px-6 py-3 font-semibold text-void transition-colors hover:bg-accent-glow"
            >
              Ready
            </button>
          ) : (
            <p className="text-muted text-sm">Loading the song</p>
          )}
          <LeaveLink />
        </div>
      </Scrim>
    );
  }

  return (
    <Scrim label="Match result">
      <div className="flex flex-col items-center gap-4">
        {opponentDone ? (
          <h2 className="font-bold text-3xl">
            {outcomeTitle(myPoints, theirPoints)}
          </h2>
        ) : (
          <p className="text-muted text-sm">
            Waiting for the other player to finish
          </p>
        )}
        {mySummary === null ? (
          <p className="font-mono text-muted text-sm tabular-nums">
            you {myPoints} · them {theirPoints}
          </p>
        ) : (
          <MatchSummary
            mine={mySummary}
            theirs={theirSummary}
            myName="you"
            theirName={opponentName}
            coop={coop}
          />
        )}
        {theirRematch && !myRematch ? (
          <p className="text-muted text-sm">They asked for a rematch</p>
        ) : null}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onRematch}
            disabled={myRematch}
            className="rounded-full bg-accent px-5 py-2.5 font-semibold text-void transition-colors hover:bg-accent-glow disabled:opacity-60"
          >
            {myRematch ? "Waiting…" : "Rematch"}
          </button>
          <LeaveLink />
        </div>
      </div>
    </Scrim>
  );
}

export function outcomeTitle(mine: number, theirs: number): string {
  const outcome = battleOutcome(mine, theirs);
  return outcome === "win"
    ? "You win"
    : outcome === "loss"
      ? "You lose"
      : "A draw";
}

function LeaveLink() {
  return (
    <a
      href="/"
      className="rounded-full border border-line-strong px-5 py-2.5 font-medium text-sm transition-colors hover:border-accent hover:text-accent"
    >
      Leave
    </a>
  );
}

function Scrim({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="dialog"
      aria-label={label}
      className="absolute inset-0 z-40 flex items-center justify-center bg-void/70 backdrop-blur-sm"
    >
      {children}
    </div>
  );
}
