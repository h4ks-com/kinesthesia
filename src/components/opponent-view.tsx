"use client";

import { HitFlag } from "@/components/hit-flag";
import { PianoRollView } from "@/components/piano-roll-view";
import type { Part } from "@/lib/midi/part";
import type { Song } from "@/lib/midi/song";
import { usePartRoll } from "@/lib/midi/use-part-roll";
import type { Opponent } from "@/lib/multiplayer/protocol";
import { defaultKeyWidth } from "@/lib/render/keyboard";
import type { Hit } from "@/lib/scoring/use-gates";

type OpponentViewProps = {
  song: Song;
  hiddenTracks: ReadonlySet<number>;
  opponent: Opponent;
  /** What they told us they are playing, so their roll shows the part they
   * see rather than notes they never owed. */
  part: Part | null;
  /** The local round clock: both sides roll from the same start, so their roll
   * scrolls off our own position and stays smooth without any note events. */
  getPosition: () => number;
  hit: Hit | null;
  state: "waiting" | "playing" | "gone";
};

const statusNote: Record<OpponentViewProps["state"], string | null> = {
  waiting: "waiting for a player",
  playing: null,
  gone: "they left",
};

// Only a running round follows the clock; before and after, the roll holds.
const frozen = (): number => 0;

export function OpponentView({
  song,
  hiddenTracks,
  opponent,
  part,
  getPosition,
  hit,
  state,
}: OpponentViewProps) {
  const clock = state === "playing" ? getPosition : frozen;
  const roll = usePartRoll(song, part, clock);

  return (
    <section className="relative flex min-h-0 min-w-0 flex-1 flex-col border-line max-lg:border-t lg:border-l">
      <header className="flex h-14 shrink-0 items-center gap-2 border-line border-b bg-panel/70 px-3">
        <span className="truncate font-medium text-sm">
          {state === "waiting" ? "Opponent" : opponent.name}
        </span>
        {state === "waiting" ? null : (
          <span className="ml-auto flex items-center gap-2 font-mono text-xs">
            <span className="text-accent">{opponent.points}</span>
            <span className="text-faint">
              {Math.round(opponent.accuracy * 100)}% · {opponent.combo}x
            </span>
          </span>
        )}
      </header>
      <div className="relative min-h-0 flex-1">
        <PianoRollView
          song={song}
          hiddenTracks={hiddenTracks}
          keyWidth={defaultKeyWidth}
          focusPitch={null}
          getPosition={clock}
          getPressed={roll.getPressed}
          getOwed={roll.getOwed}
          getYours={roll.getYours}
        />
        <HitFlag hit={state === "playing" ? hit : null} />
        {statusNote[state] === null ? null : (
          <p className="-translate-x-1/2 absolute top-4 left-1/2 rounded-full border border-line-strong bg-panel/90 px-3 py-1 text-muted text-xs backdrop-blur">
            {statusNote[state]}
          </p>
        )}
      </div>
      <div className="h-16 shrink-0 border-line border-t bg-panel" />
    </section>
  );
}
