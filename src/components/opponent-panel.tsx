"use client";

import { type ReactNode, useEffect, useState } from "react";
import { HitFlag } from "@/components/hit-flag";
import { PartControls } from "@/components/part-controls";
import { PianoRollView } from "@/components/piano-roll-view";
import { ScoreReadout } from "@/components/ui/score-readout";
import { clampMelodyRate, defaultMelodyRate } from "@/lib/midi/melody";
import {
  type Part,
  soloHidden,
  toggleHidden,
  tracksToHide,
} from "@/lib/midi/part";
import type { Song } from "@/lib/midi/song";
import { usePartRoll } from "@/lib/midi/use-part-roll";
import type { Opponent } from "@/lib/multiplayer/protocol";
import { defaultKeyWidth } from "@/lib/render/keyboard";
import type { Hit } from "@/lib/scoring/use-gates";

type OpponentPanelProps = {
  song: Song;
  /** What they play: the host's own line in a battle, the one the host built
   * for them in a co-op. Null until we know it. */
  part: Part | null;
  /** Building their part is the host's job, and only until the invite is out. */
  onPart: ((part: Part) => void) | null;
  coop: boolean;
  /** Null for a joiner, whose side is whatever the host prepared. */
  onCoop: ((coop: boolean) => void) | null;
  /** The invite freezes the setup: from then on both sides only watch. */
  locked: boolean;
  opponent: Opponent;
  /** The local round clock: both sides roll from the same start, so their roll
   * scrolls off our own position and stays smooth without any note events. */
  getPosition: () => number;
  hit: Hit | null;
  state: "waiting" | "playing" | "gone";
};

const nothingHidden: ReadonlySet<number> = new Set();

export function OpponentPanel({
  song,
  part,
  onPart,
  coop,
  onCoop,
  locked,
  opponent,
  getPosition,
  hit,
  state,
}: OpponentPanelProps) {
  const [hidden, setHidden] = useState<ReadonlySet<number>>(nothingHidden);
  // Their roll rides the shared timeline, so scrubbing reads ahead on both.
  const roll = usePartRoll(song, part, getPosition);
  const theirs = part?.tracks ?? [];
  const simplified = part?.simplified ?? false;

  // Their roll opens on the line they owe, the same as your own side does, so
  // the two halves frame the same stretch. With nothing claimed there is no
  // line to frame, so the song stays whole rather than going blank.
  const claim = theirs.join(",");
  useEffect(() => {
    const mine = new Set(claim === "" ? [] : claim.split(",").map(Number));
    setHidden(mine.size === 0 ? nothingHidden : tracksToHide(song, mine));
  }, [claim, song]);

  function change(next: Partial<Part>): void {
    if (part !== null) {
      onPart?.({ ...part, ...next });
    }
  }

  return (
    <section
      aria-label="Other player"
      className="relative flex min-h-0 min-w-0 flex-1 flex-col border-line max-lg:border-t lg:border-l"
    >
      <header
        data-tour="opponent"
        className="flex h-14 shrink-0 items-center gap-2 border-line border-b bg-panel/70 px-3"
      >
        {onCoop === null ? null : (
          <MatchType coop={coop} onCoop={onCoop} locked={locked} />
        )}

        <span className="min-w-0 flex-1 truncate font-medium text-sm">
          {state === "waiting" ? "Opponent" : opponent.name}
        </span>

        <ScoreReadout
          points={opponent.points}
          accuracy={opponent.accuracy}
          combo={opponent.combo}
        />

        <PartControls
          tracks={song.tracks}
          hidden={hidden}
          mine={new Set(theirs)}
          onToggleVisible={(index) =>
            setHidden((current) => toggleHidden(current, index))
          }
          onSolo={(index) =>
            setHidden((current) =>
              soloHidden(
                song.tracks.map((track) => track.index),
                current,
                index,
              ),
            )
          }
          onClaim={
            onPart === null
              ? null
              : (index) =>
                  change({
                    tracks: [...toggleHidden(new Set(theirs), index)].sort(
                      (left, right) => left - right,
                    ),
                  })
          }
          simplified={simplified}
          onSimplified={
            onPart === null ? null : (next) => change({ simplified: next })
          }
          melodyRate={part?.melodyRate ?? defaultMelodyRate}
          onMelodyRate={
            onPart === null
              ? null
              : (rate) => change({ melodyRate: clampMelodyRate(rate) })
          }
          whose="theirs"
          voicing={new Map()}
          onVoicing={null}
          sound={null}
          lockedNote={
            coop ? "Set by the host" : "A battle: they play your part"
          }
        />
      </header>

      <div className="relative min-h-0 flex-1">
        <PianoRollView
          song={song}
          hiddenTracks={hidden}
          keyWidth={defaultKeyWidth}
          focusPitch={roll.focusPitch}
          getPosition={getPosition}
          getPressed={roll.getPressed}
          getOwed={roll.getOwed}
          getYours={roll.getYours}
        />
        <HitFlag hit={state === "playing" ? hit : null} />
        {state === "gone" ? (
          <p className="-translate-x-1/2 absolute top-4 left-1/2 rounded-full border border-line-strong bg-panel/90 px-3 py-1 text-muted text-xs backdrop-blur">
            they left
          </p>
        ) : null}
      </div>
    </section>
  );
}

/** Battle locks both sides to one part; co-op lets the host set a part per
 * side. It is the first thing the host decides for the other player. */
function MatchType({
  coop,
  onCoop,
  locked,
}: {
  coop: boolean;
  onCoop: (coop: boolean) => void;
  locked: boolean;
}) {
  return (
    <fieldset className="flex shrink-0 items-center rounded-full border border-line-strong p-0.5">
      <legend className="sr-only">Match type</legend>
      <MatchTypeOption on={!coop} locked={locked} onPick={() => onCoop(false)}>
        Battle
      </MatchTypeOption>
      <MatchTypeOption on={coop} locked={locked} onPick={() => onCoop(true)}>
        Co-op
      </MatchTypeOption>
    </fieldset>
  );
}

function MatchTypeOption({
  on,
  locked,
  onPick,
  children,
}: {
  on: boolean;
  locked: boolean;
  onPick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={locked}
      aria-pressed={on}
      onClick={onPick}
      className={`rounded-full px-2.5 py-0.5 text-xs transition-colors disabled:opacity-60 ${
        on ? "bg-accent text-void" : "text-muted enabled:hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}
