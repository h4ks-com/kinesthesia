"use client";

import { Hand, Layers, Radio } from "lucide-react";
import { Popover } from "@/components/ui/popover";
import { trackColor } from "@/lib/midi/palette";
import type { SongTrack } from "@/lib/midi/song";

type TrackMenuProps = {
  tracks: readonly SongTrack[];
  hidden: ReadonlySet<number>;
  mine: ReadonlySet<number>;
  interactive: boolean;
  canClaim: boolean;
  onToggleVisible: (index: number) => void;
  onToggleMine: (index: number) => void;
  onSolo: (index: number) => void;
};

export function TrackMenu({
  tracks,
  hidden,
  mine,
  interactive,
  canClaim,
  onToggleVisible,
  onToggleMine,
  onSolo,
}: TrackMenuProps) {
  if (tracks.length <= 1) {
    return null;
  }

  const visible = tracks.filter((track) => !hidden.has(track.index));
  const soloed = visible.length === 1 ? (visible[0]?.index ?? null) : null;

  return (
    <Popover
      label="Tracks"
      trigger={(open) => (
        <span
          data-tip="Show or hide tracks"
          className={`inline-flex items-center gap-1.5 rounded-lg border py-2 pr-2 pl-2 transition-colors ${
            open
              ? "border-accent text-accent"
              : "border-line-strong text-muted hover:border-accent hover:text-accent"
          }`}
        >
          <Layers className="size-4" aria-hidden="true" />
          <span className="font-mono text-faint text-xs">
            {tracks.length - hidden.size}/{tracks.length}
          </span>
        </span>
      )}
    >
      <div className="w-[19rem] max-sm:w-auto">
        {tracks.map((track) => {
          const visible = !hidden.has(track.index);
          const claimed = mine.has(track.index);
          const color = trackColor(track.index);
          return (
            <div
              key={track.index}
              className="flex min-w-0 items-center gap-0.5"
            >
              <button
                type="button"
                onClick={() => onToggleVisible(track.index)}
                aria-pressed={visible}
                className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-raised"
                style={{ opacity: visible ? 1 : 0.4 }}
              >
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{
                    background: visible ? color.glow : "transparent",
                    boxShadow: visible ? `0 0 10px ${color.glow}` : "none",
                    border: visible ? "none" : `1.5px solid ${color.glow}`,
                  }}
                />
                <span className="min-w-0 truncate text-sm">{track.name}</span>
                <span className="ml-auto shrink-0 font-mono text-faint text-[0.7rem]">
                  {track.noteCount}
                </span>
              </button>
              <button
                type="button"
                onClick={() => onSolo(track.index)}
                aria-pressed={soloed === track.index}
                aria-label={`Show only ${track.name}`}
                data-tip={soloed === track.index ? "Show all" : "Solo"}
                className={`shrink-0 rounded-lg p-1.5 transition-colors ${
                  soloed === track.index
                    ? "text-accent"
                    : "text-faint hover:bg-raised hover:text-accent"
                }`}
              >
                <Radio className="size-4" aria-hidden="true" />
              </button>
              {interactive && canClaim ? (
                <button
                  type="button"
                  onClick={() => onToggleMine(track.index)}
                  aria-pressed={claimed}
                  aria-label={`Play ${track.name} yourself`}
                  data-tip="Play this one"
                  className={`shrink-0 rounded-lg p-1.5 transition-colors ${
                    claimed
                      ? "bg-accent text-void"
                      : "text-faint hover:bg-raised hover:text-accent"
                  }`}
                >
                  <Hand className="size-4" aria-hidden="true" />
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </Popover>
  );
}
