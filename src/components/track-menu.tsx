"use client";

import { useState } from "react";
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
  const [open, setOpen] = useState(false);

  if (tracks.length <= 1) {
    return null;
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm"
      >
        Tracks
      </button>
      {open ? (
        <div className="absolute right-0 top-[calc(100%+6px)] z-10 max-h-[60vh] w-64 overflow-auto rounded-xl border border-zinc-700 bg-zinc-950 p-2 shadow-xl">
          {tracks.map((track) => {
            const visible = !hidden.has(track.index);
            const color = trackColor(track.index);
            return (
              <div
                key={track.index}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-zinc-900"
              >
                <button
                  type="button"
                  onClick={() => onToggleVisible(track.index)}
                  className="flex flex-1 items-center gap-2 text-left text-sm"
                  style={{ opacity: visible ? 1 : 0.4 }}
                >
                  <span
                    className="size-3 shrink-0 rounded-full"
                    style={{
                      background: visible ? color.glow : "transparent",
                      boxShadow: visible ? `0 0 9px ${color.glow}` : "none",
                      border: visible ? "none" : `2px solid ${color.glow}`,
                    }}
                  />
                  <span className="truncate">{track.name}</span>
                </button>
                {interactive ? (
                  <button
                    type="button"
                    onClick={() => onToggleMine(track.index)}
                    className="rounded-md border border-zinc-700 px-2 py-0.5 text-xs"
                    style={{
                      background: mine.has(track.index)
                        ? color.glow
                        : "transparent",
                      color: mine.has(track.index) ? "#05060a" : "inherit",
                    }}
                  >
                    mine
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
