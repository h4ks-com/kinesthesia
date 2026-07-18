"use client";

import { useCallback } from "react";
import { PianoRollView } from "@/components/piano-roll-view";
import type { Opponent } from "@/lib/battle/protocol";
import type { Song } from "@/lib/midi/song";
import { defaultKeyWidth } from "@/lib/render/keyboard";

type OpponentViewProps = {
  song: Song;
  hiddenTracks: ReadonlySet<number>;
  opponent: Opponent;
  pressed: () => ReadonlySet<number>;
  connected: boolean;
};

/** The opponent's roll is driven entirely by what arrives over the wire, and it
 * is silent by design: you watch their hands, you do not hear them. */
const nothingOwed = (): ReadonlySet<number> => new Set();

export function OpponentView({
  song,
  hiddenTracks,
  opponent,
  pressed,
  connected,
}: OpponentViewProps) {
  const getPosition = useCallback(() => opponent.position, [opponent.position]);

  return (
    <section className="relative flex min-h-0 min-w-0 flex-1 flex-col border-line max-lg:border-t lg:border-l">
      <header className="flex h-14 shrink-0 items-center gap-2 border-line border-b bg-panel/70 px-3">
        <span className="truncate font-medium text-sm">{opponent.name}</span>
        <span className="ml-auto flex items-center gap-2 font-mono text-xs">
          <span className="text-accent">{opponent.points}</span>
          <span className="text-faint">
            {Math.round(opponent.accuracy * 100)}% · {opponent.combo}x
          </span>
        </span>
      </header>
      <div className="relative min-h-0 flex-1">
        <PianoRollView
          song={song}
          hiddenTracks={hiddenTracks}
          keyWidth={defaultKeyWidth}
          getPosition={getPosition}
          getPressed={pressed}
          getOwed={nothingOwed}
        />
        {connected ? null : (
          <p className="-translate-x-1/2 absolute top-4 left-1/2 rounded-full border border-line-strong bg-panel/90 px-3 py-1 text-muted text-xs backdrop-blur">
            they left
          </p>
        )}
      </div>
      <div className="h-16 shrink-0 border-line border-t bg-panel" />
    </section>
  );
}
