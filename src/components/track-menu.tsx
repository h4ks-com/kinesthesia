"use client";

import { Hand, Layers } from "lucide-react";
import { Popover } from "@/components/ui/popover";
import { trackColor } from "@/lib/midi/palette";
import type { SongTrack } from "@/lib/midi/song";

type TrackMenuProps = {
  tracks: readonly SongTrack[];
  hidden: ReadonlySet<number>;
  mine: ReadonlySet<number>;
  interactive: boolean;
  onToggleVisible: (index: number) => void;
  onToggleMine: (index: number) => void;
};

export function TrackMenu({
  tracks,
  hidden,
  mine,
  interactive,
  onToggleVisible,
  onToggleMine,
}: TrackMenuProps) {
  if (tracks.length <= 1) {
    return null;
  }

  return (
    <Popover
      label="Tracks"
      trigger={(open) => (
        <span
          data-tip="Show or hide tracks"
          className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 font-medium text-sm transition-colors ${
            open
              ? "border-accent text-accent"
              : "border-line-strong text-text hover:border-accent hover:text-accent"
          }`}
        >
          <Layers className="size-4" aria-hidden="true" />
          Tracks
          <span className="font-mono text-faint text-xs">
            {tracks.length - hidden.size}/{tracks.length}
          </span>
        </span>
      )}
    >
      <div className="w-72">
        {tracks.map((track) => {
          const visible = !hidden.has(track.index);
          const claimed = mine.has(track.index);
          const color = trackColor(track.index);
          return (
            <div key={track.index} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onToggleVisible(track.index)}
                aria-pressed={visible}
                className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-raised"
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
                <span className="truncate text-sm">{track.name}</span>
                <span className="ml-auto shrink-0 font-mono text-faint text-xs">
                  {track.noteCount}
                </span>
              </button>
              {interactive ? (
                <button
                  type="button"
                  onClick={() => onToggleMine(track.index)}
                  aria-pressed={claimed}
                  aria-label={`Play ${track.name} yourself`}
                  data-tip="Play this one"
                  className={`shrink-0 rounded-lg p-2 transition-colors ${
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
