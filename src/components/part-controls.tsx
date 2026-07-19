"use client";

import { Music2 } from "lucide-react";
import { type SoundSharing, TrackMenu } from "@/components/track-menu";
import { Popover } from "@/components/ui/popover";
import { SliderRow } from "@/components/ui/slider-row";
import type { SongVoicing, Voicing } from "@/lib/audio/voicing";
import { type MelodyRate, melodyRateRange } from "@/lib/midi/melody";
import type { SongTrack } from "@/lib/midi/song";

type PartControlsProps = {
  tracks: readonly SongTrack[];
  hidden: ReadonlySet<number>;
  mine: ReadonlySet<number>;
  onToggleVisible: (index: number) => void;
  onSolo: (index: number) => void;
  voicing: SongVoicing;
  onVoicing: ((track: number, voicing: Voicing) => void) | null;
  sound: SoundSharing | null;
  /** Null once the part is fixed, which leaves the control disabled in place so
   * both halves keep the same shape. */
  onClaim: ((index: number) => void) | null;
  simplified: boolean;
  onSimplified: ((simplified: boolean) => void) | null;
  melodyRate: MelodyRate;
  onMelodyRate: ((rate: number) => void) | null;
  /** Whose part this is, so the labels read right on either half. */
  whose: "yours" | "theirs";
  /** Why their side is fixed, when it is. */
  lockedNote?: string;
};

export function PartControls({
  tracks,
  hidden,
  mine,
  onToggleVisible,
  onSolo,
  voicing,
  onVoicing,
  sound,
  onClaim,
  simplified,
  onSimplified,
  melodyRate,
  onMelodyRate,
  whose,
  lockedNote,
}: PartControlsProps) {
  const theirs = whose === "theirs";
  const simplifyLabel = theirs
    ? "Simplify their part to one note at a time"
    : "Simplify to one note at a time";
  const rateLabel = theirs
    ? "Their maximum notes per second"
    : "Maximum notes per second";
  const density = theirs ? "Their note density" : "Note density";

  return (
    <>
      <TrackMenu
        tracks={tracks}
        hidden={hidden}
        mine={mine}
        interactive
        canClaim={onClaim !== null}
        voicing={voicing}
        onVoicing={onVoicing}
        sound={sound}
        onToggleVisible={onToggleVisible}
        onToggleMine={(index) => onClaim?.(index)}
        onSolo={onSolo}
      />

      <button
        type="button"
        disabled={onSimplified === null}
        onClick={() => onSimplified?.(!simplified)}
        aria-pressed={simplified}
        aria-label={simplifyLabel}
        data-tip={
          onSimplified === null
            ? (lockedNote ?? "Fixed for this match")
            : simplified
              ? "Play the full part"
              : "One note at a time"
        }
        className={`shrink-0 rounded-lg border p-2 transition-colors disabled:opacity-50 ${
          simplified
            ? "border-accent bg-accent-soft text-accent"
            : "border-line-strong text-muted enabled:hover:border-accent enabled:hover:text-accent"
        }`}
      >
        <Music2 className="size-4" aria-hidden="true" />
      </button>

      {simplified && onMelodyRate === null ? (
        <span
          data-tip={lockedNote ?? "Fixed for this match"}
          className="inline-flex shrink-0 items-center rounded-lg border border-line-strong p-2 font-mono text-muted text-xs opacity-50"
        >
          <span className="sr-only">{density}: </span>
          {melodyRate}/s
        </span>
      ) : null}

      {simplified && onMelodyRate !== null ? (
        <Popover
          label={density}
          align="right"
          trigger={(open) => (
            <span
              data-tip={density}
              className={`inline-flex items-center rounded-lg border p-2 font-mono text-xs transition-colors ${
                open
                  ? "border-accent text-accent"
                  : "border-line-strong text-muted hover:border-accent hover:text-accent"
              }`}
            >
              {melodyRate}/s
            </span>
          )}
        >
          <div className="w-56 p-1 max-sm:w-full">
            <h3 className="label px-2">{density}</h3>
            <SliderRow
              ariaLabel={rateLabel}
              min={melodyRateRange.min}
              max={melodyRateRange.max}
              step={1}
              value={melodyRate}
              valueText={`${melodyRate}/sec`}
              onChange={(rate) => onMelodyRate?.(rate)}
            />
            <p className="px-2 pb-1 font-mono text-[0.7rem] text-faint leading-relaxed">
              Lower keeps the peaks of the tune and drops the rest.
            </p>
          </div>
        </Popover>
      ) : null}
    </>
  );
}
