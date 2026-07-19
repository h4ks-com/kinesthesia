"use client";

import {
  Hand,
  Layers,
  Radio,
  RotateCcw,
  SlidersHorizontal,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { SoundView } from "@/components/sound-view";
import { Popover } from "@/components/ui/popover";
import {
  defaultVoicing,
  isDefaultVoicing,
  type SongVoicing,
  type Voicing,
} from "@/lib/audio/voicing";
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
  voicing: SongVoicing;
  /** Null while the sound is not this listener's to change. */
  onVoicing: ((track: number, voicing: Voicing) => void) | null;
  sound: SoundSharing | null;
};

/** How a song's sound is shared: whose is playing, whether this listener has
 * moved anything, and whether they can put it back for everyone. */
export type SoundSharing = {
  readonly playing: string;
  readonly dirty: boolean;
  readonly canSave: boolean;
  readonly onSave: () => void;
  readonly onReset: () => void;
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
  voicing,
  onVoicing,
  sound,
}: TrackMenuProps) {
  const [shaping, setShaping] = useState<number | null>(null);
  const [returning, setReturning] = useState<number | null>(null);
  const shapeButtons = useRef(new Map<number, HTMLButtonElement>());

  // Coming back from the sound view rebuilds the list, so the row that was
  // opened takes the reading position again.
  useEffect(() => {
    if (returning === null) {
      return;
    }
    shapeButtons.current.get(returning)?.focus();
    setReturning(null);
  }, [returning]);

  if (tracks.length <= 1) {
    return null;
  }

  const visible = tracks.filter((track) => !hidden.has(track.index));
  const soloed = visible.length === 1 ? (visible[0]?.index ?? null) : null;
  const shaped = tracks.find((track) => track.index === shaping) ?? null;

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
      {shaped === null || onVoicing === null ? (
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
                {onVoicing === null ? null : (
                  <button
                    ref={(node) => {
                      if (node === null) {
                        shapeButtons.current.delete(track.index);
                        return;
                      }
                      shapeButtons.current.set(track.index, node);
                    }}
                    type="button"
                    onClick={() => setShaping(track.index)}
                    aria-label={`Change how ${track.name} sounds`}
                    data-tip="How it sounds"
                    className={`shrink-0 rounded-lg p-1.5 transition-colors ${
                      isDefaultVoicing(
                        voicing.get(track.index) ?? defaultVoicing(track),
                        track,
                      )
                        ? "text-faint hover:bg-raised hover:text-accent"
                        : "text-accent hover:bg-raised"
                    }`}
                  >
                    <SlidersHorizontal className="size-4" aria-hidden="true" />
                  </button>
                )}
              </div>
            );
          })}
          {sound === null || (!sound.dirty && sound.playing === "") ? null : (
            <div className="mt-1 flex items-center gap-2 border-line border-t px-2 pt-2">
              <p className="min-w-0 flex-1 font-mono text-[0.7rem] text-faint leading-relaxed">
                {sound.dirty
                  ? sound.canSave
                    ? "Yours, not saved"
                    : "Sign in to keep this"
                  : `Sound by ${sound.playing}`}
              </p>
              {sound.dirty && sound.canSave ? (
                <button
                  type="button"
                  onClick={sound.onSave}
                  className="shrink-0 rounded-lg border border-accent px-2 py-1 font-mono text-[0.7rem] text-accent transition-colors hover:bg-accent hover:text-void"
                >
                  Save
                </button>
              ) : null}
              <button
                type="button"
                onClick={sound.onReset}
                aria-label="Back to the sounds in the file"
                data-tip="Back to the sounds in the file"
                className="shrink-0 rounded-lg p-1.5 text-faint transition-colors hover:bg-raised hover:text-accent"
              >
                <RotateCcw className="size-4" aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      ) : (
        <SoundView
          track={shaped}
          voicing={voicing.get(shaped.index) ?? defaultVoicing(shaped)}
          onChange={(next) => onVoicing(shaped.index, next)}
          onBack={() => {
            setReturning(shaped.index);
            setShaping(null);
          }}
        />
      )}
    </Popover>
  );
}
