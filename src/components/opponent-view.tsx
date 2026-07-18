"use client";

import { useCallback, useMemo } from "react";
import { PianoRollView } from "@/components/piano-roll-view";
import type { Opponent } from "@/lib/battle/protocol";
import { type MelodyRate, reduceToMelody } from "@/lib/midi/melody";
import type { Song } from "@/lib/midi/song";
import { defaultKeyWidth } from "@/lib/render/keyboard";

type OpponentViewProps = {
  song: Song;
  hiddenTracks: ReadonlySet<number>;
  opponent: Opponent;
  /** What they told us they are playing, so their roll shows the part they
   * see rather than notes they never owed. */
  part: {
    readonly simplified: boolean;
    readonly melodyRate: MelodyRate;
    readonly tracks: readonly number[];
  } | null;
  pressed: () => ReadonlySet<number>;
  state: "waiting" | "playing" | "gone";
};

const statusNote: Record<OpponentViewProps["state"], string | null> = {
  waiting: "waiting for a player",
  playing: null,
  gone: "they left",
};

/** The opponent's roll is driven entirely by what arrives over the wire, and it
 * is silent by design: you watch their hands, you do not hear them. */
const nothingOwed = (): ReadonlySet<number> => new Set();

export function OpponentView({
  song,
  hiddenTracks,
  opponent,
  part,
  pressed,
  state,
}: OpponentViewProps) {
  const getPosition = useCallback(() => opponent.position, [opponent.position]);
  // Their roll lights the part they owe and ghosts the rest, the same as your
  // own side, so both halves read alike.
  const theirs = useMemo(() => {
    if (part === null) {
      return null;
    }
    const tracks = new Set(part.tracks);
    const line = part.simplified
      ? reduceToMelody(song, { tracks, maxNotesPerSecond: part.melodyRate })
      : song.notes.filter((note) => tracks.has(note.track));
    return new Set(line.map((note) => note.id));
  }, [song, part]);
  const getTheirs = useCallback(() => theirs, [theirs]);

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
          getPosition={getPosition}
          getPressed={pressed}
          getOwed={nothingOwed}
          getYours={getTheirs}
        />
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
