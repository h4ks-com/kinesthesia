"use client";

import { PianoRollView } from "@/components/piano-roll-view";
import { clampMelodyRate } from "@/lib/midi/melody";
import { trackColor } from "@/lib/midi/palette";
import type { Part } from "@/lib/midi/part";
import type { Song } from "@/lib/midi/song";
import { usePartRoll } from "@/lib/midi/use-part-roll";
import { defaultKeyWidth } from "@/lib/render/keyboard";

type OpponentSetupProps = {
  song: Song;
  part: Part;
  onChange: (part: Part) => void;
  getPosition: () => number;
};

const noneHidden: ReadonlySet<number> = new Set();

/** The host builds the other side's part here: a co-op hands each player a
 * different one, so this roll previews what the joiner will owe. */
export function OpponentSetup({
  song,
  part,
  onChange,
  getPosition,
}: OpponentSetupProps) {
  const roll = usePartRoll(song, part, getPosition);

  function toggleTrack(index: number): void {
    const tracks = new Set(part.tracks);
    if (tracks.has(index)) {
      tracks.delete(index);
    } else {
      tracks.add(index);
    }
    onChange({
      ...part,
      tracks: [...tracks].sort((left, right) => left - right),
    });
  }

  return (
    <section className="relative flex min-h-0 min-w-0 flex-1 flex-col border-line max-lg:border-t lg:border-l">
      <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-line border-b bg-panel/70 px-3 py-2">
        <span className="shrink-0 font-medium text-muted text-xs">
          Opponent plays
        </span>
        <div className="flex flex-wrap items-center gap-1">
          {song.tracks.map((track) => {
            const on = part.tracks.includes(track.index);
            const color = trackColor(track.index);
            return (
              <button
                key={track.index}
                type="button"
                onClick={() => toggleTrack(track.index)}
                aria-pressed={on}
                className={`flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs transition-colors ${
                  on
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-line-strong text-muted hover:border-accent"
                }`}
              >
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{
                    background: on ? color.glow : "transparent",
                    border: on ? "none" : `1.5px solid ${color.glow}`,
                  }}
                />
                <span className="max-w-24 truncate">{track.name}</span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => onChange({ ...part, simplified: !part.simplified })}
          aria-pressed={part.simplified}
          className={`ml-auto shrink-0 rounded-full border px-2.5 py-1 text-xs transition-colors ${
            part.simplified
              ? "border-accent bg-accent-soft text-accent"
              : "border-line-strong text-muted hover:border-accent"
          }`}
        >
          Simplify
        </button>
        {part.simplified ? (
          <label className="flex shrink-0 items-center gap-1.5 font-mono text-faint text-xs">
            <input
              type="range"
              min={1}
              max={12}
              step={1}
              value={part.melodyRate}
              onChange={(event) =>
                onChange({
                  ...part,
                  melodyRate: clampMelodyRate(Number(event.target.value)),
                })
              }
              aria-label="Opponent note rate"
              className="w-20"
            />
            {part.melodyRate}/s
          </label>
        ) : null}
      </header>
      <div className="relative min-h-0 flex-1">
        <PianoRollView
          song={song}
          hiddenTracks={noneHidden}
          keyWidth={defaultKeyWidth}
          focusPitch={null}
          getPosition={getPosition}
          getPressed={roll.getPressed}
          getOwed={roll.getOwed}
          getYours={roll.getYours}
        />
      </div>
      <div className="h-16 shrink-0 border-line border-t bg-panel" />
    </section>
  );
}
