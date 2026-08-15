"use client";

import { Hand as HandIcon, Music2 } from "lucide-react";
import type { ReactNode } from "react";
import { type SoundSharing, TrackMenu } from "@/components/track-menu";
import { Popover } from "@/components/ui/popover";
import { SliderRow } from "@/components/ui/slider-row";
import { Toggle } from "@/components/ui/toggle";
import type { SongVoicing, Voicing } from "@/lib/audio/voicing";
import type { Hand } from "@/lib/midi/hands";
import { type MelodyRate, melodyRateRange } from "@/lib/midi/melody";
import type { SongNote, SongTrack } from "@/lib/midi/song";

type PartControlsProps = {
  tracks: readonly SongTrack[];
  notes: readonly SongNote[];
  getPosition: () => number;
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
  hand: Hand | null;
  onHand: ((hand: Hand | null) => void) | null;
  /** Whose part this is, so the labels read right on either half. */
  whose: "yours" | "theirs";
  /** Why their side is fixed, when it is. */
  lockedNote?: string;
};

const handOptions: readonly { hand: Hand | null; label: string }[] = [
  { hand: null, label: "Both hands" },
  { hand: "left", label: "Left hand" },
  { hand: "right", label: "Right hand" },
];

/** Right hand is the glyph as drawn; left mirrors it; both hands composes two
 * small copies, one of each, so a side is told apart by orientation rather
 * than by hunting for three unrelated icons. */
function HandGlyph({
  hand,
  className,
}: {
  hand: Hand | null;
  className: string;
}): ReactNode {
  if (hand === "left") {
    return (
      <HandIcon className={`${className} scale-x-[-1]`} aria-hidden="true" />
    );
  }
  if (hand === "right") {
    return <HandIcon className={className} aria-hidden="true" />;
  }
  return (
    <span
      aria-hidden="true"
      className={`${className} inline-flex w-5 items-center justify-center`}
    >
      <HandIcon className="size-3 scale-x-[-1]" />
      <HandIcon className="-ml-0.5 size-3" />
    </span>
  );
}

export function PartControls({
  tracks,
  notes,
  getPosition,
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
  hand,
  onHand,
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
  const handGroupLabel = theirs ? "Their hand" : "Hand";
  const chosenHand = handOptions.find((option) => option.hand === hand) ?? {
    hand: null,
    label: "Both hands",
  };

  return (
    <>
      <TrackMenu
        tracks={tracks}
        notes={notes}
        getPosition={getPosition}
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

      {onSimplified === null ? (
        <button
          type="button"
          data-tour="simplify"
          disabled
          aria-pressed={simplified}
          aria-label={simplifyLabel}
          data-tip={lockedNote ?? "Fixed for this match"}
          className="shrink-0 rounded-lg border border-line-strong p-2 text-muted opacity-50"
        >
          <Music2 className="size-4" aria-hidden="true" />
        </button>
      ) : (
        <Popover
          label={`${simplifyLabel}, ${simplified ? "on" : "off"}`}
          align="right"
          trigger={(open) => (
            <span
              data-tour="simplify"
              data-tip={simplifyLabel}
              data-tip-align="right"
              className={`inline-flex items-center rounded-lg border p-2 transition-colors ${
                open || simplified
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-line-strong text-muted hover:border-accent hover:text-accent"
              }`}
            >
              <Music2 className="size-4" aria-hidden="true" />
            </span>
          )}
        >
          <div className="flex w-56 flex-col gap-1 p-1 max-sm:w-full">
            <Toggle
              label={theirs ? "simplify their part" : "simplify"}
              checked={simplified}
              onChange={onSimplified}
              tip={
                simplified
                  ? "Play the full part"
                  : "Reduce this part to one note at a time"
              }
            />
            {simplified ? (
              <div className="border-line border-t pt-1">
                <h3 className="label px-2">{density}</h3>
                {onMelodyRate === null ? (
                  <p
                    data-tip={lockedNote ?? "Fixed for this match"}
                    className="px-2 py-1.5 font-mono text-muted text-xs opacity-70"
                  >
                    <span className="sr-only">{density}: </span>
                    {melodyRate}/s
                  </p>
                ) : (
                  <>
                    <SliderRow
                      ariaLabel={rateLabel}
                      min={melodyRateRange.min}
                      max={melodyRateRange.max}
                      step={1}
                      value={melodyRate}
                      valueText={`${melodyRate}/sec`}
                      onChange={onMelodyRate}
                    />
                    <p className="px-2 pb-1 font-mono text-[0.7rem] text-faint leading-relaxed">
                      Lower keeps the peaks of the tune and drops the rest.
                    </p>
                  </>
                )}
              </div>
            ) : null}
          </div>
        </Popover>
      )}

      {onHand === null ? (
        <button
          type="button"
          disabled
          aria-label={`${handGroupLabel}, ${chosenHand.label.toLowerCase()}`}
          data-tip={lockedNote ?? "Fixed for this match"}
          className="inline-flex shrink-0 items-center rounded-lg border border-line-strong p-2 text-muted opacity-50"
        >
          <HandGlyph hand={chosenHand.hand} className="size-4" />
        </button>
      ) : (
        <Popover
          label={`${handGroupLabel}, ${chosenHand.label.toLowerCase()}`}
          align="right"
          trigger={(open) => (
            <span
              data-tip="Which hand you play"
              data-tip-align="right"
              className={`inline-flex items-center rounded-lg border p-2 transition-colors ${
                open || hand !== null
                  ? "border-accent text-accent"
                  : "border-line-strong text-muted hover:border-accent hover:text-accent"
              }`}
            >
              <HandGlyph hand={chosenHand.hand} className="size-4" />
            </span>
          )}
        >
          {(close) => (
            <div className="flex w-44 flex-col gap-0.5">
              {handOptions.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  aria-pressed={hand === option.hand}
                  onClick={() => {
                    onHand(option.hand);
                    close();
                  }}
                  className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 pointer-coarse:min-h-11 text-left text-sm transition-colors hover:bg-raised ${
                    hand === option.hand ? "text-accent" : "text-text"
                  }`}
                >
                  <HandGlyph hand={option.hand} className="size-4 shrink-0" />
                  {theirs
                    ? `Their ${option.label.toLowerCase()}`
                    : option.label}
                </button>
              ))}
            </div>
          )}
        </Popover>
      )}
    </>
  );
}
