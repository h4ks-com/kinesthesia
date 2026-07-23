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
import { soundingTracks } from "@/lib/midi/part";
import type { SongNote, SongTrack } from "@/lib/midi/song";

type TrackMenuProps = {
  tracks: readonly SongTrack[];
  /** Every note, so the list can light the channel a sounding one belongs to. */
  notes: readonly SongNote[];
  getPosition: () => number;
  voicing: SongVoicing;
  /** Null while the sound is not this listener's to change. */
  onVoicing: ((track: number, voicing: Voicing) => void) | null;
  /** The trigger's accessible name, so a mode with parts rather than a song's
   * tracks can say so. */
  label?: string;
  /** The show/hide/solo/claim controls only appear when their handlers are
   * given, so a free-roam list is just instruments and nothing to manage. */
  hidden?: ReadonlySet<number>;
  mine?: ReadonlySet<number>;
  interactive?: boolean;
  canClaim?: boolean;
  onToggleVisible?: (index: number) => void;
  onToggleMine?: (index: number) => void;
  onSolo?: (index: number) => void;
  sound?: SoundSharing | null;
};

const noneHidden: ReadonlySet<number> = new Set();

/** How a song's sound is shared: whose is playing, whether this listener has
 * moved anything, and whether they can put it back for everyone. */
export type SoundSharing = {
  readonly playing: string;
  readonly others: readonly { readonly id: string; readonly name: string }[];
  readonly dirty: boolean;
  readonly canSave: boolean;
  readonly onSave: () => void;
  readonly onAdopt: (authorId: string) => void;
  readonly onReset: () => void;
};

export function TrackMenu({
  tracks,
  notes,
  getPosition,
  voicing,
  onVoicing,
  label = "Tracks",
  hidden = noneHidden,
  mine = noneHidden,
  interactive = false,
  canClaim = false,
  onToggleVisible,
  onToggleMine,
  onSolo,
  sound = null,
}: TrackMenuProps) {
  const [shaping, setShaping] = useState<number | null>(null);
  const [returning, setReturning] = useState<number | null>(null);
  const shapeButtons = useRef(new Map<number, HTMLButtonElement>());
  const liveDots = useRef(new Map<number, HTMLSpanElement>());

  // With no show/hide handler there is nothing to manage: the list is a plain
  // set of instruments, as free-roam play wants.
  const managed = onToggleVisible !== undefined;

  // Coming back from the sound view rebuilds the list, so the row that was
  // opened takes the reading position again.
  useEffect(() => {
    if (returning === null) {
      return;
    }
    shapeButtons.current.get(returning)?.focus();
    setReturning(null);
  }, [returning]);

  const registerDot = (index: number) => (node: HTMLSpanElement | null) => {
    if (node === null) {
      liveDots.current.delete(index);
      return;
    }
    liveDots.current.set(index, node);
  };

  // One track has nothing to show, hide, solo or claim, but its instrument and
  // shaping are still worth reaching, so the menu stays for the sound alone.
  const single = tracks.length === 1;
  if (tracks.length === 0 || (single && onVoicing === null)) {
    return null;
  }

  const visible = tracks.filter((track) => !hidden.has(track.index));
  const soloed = visible.length === 1 ? (visible[0]?.index ?? null) : null;
  const shaped = tracks.find((track) => track.index === shaping) ?? null;

  return (
    <Popover
      label={label}
      trigger={(open) => (
        <span
          data-tour="tracks"
          data-tip={
            single
              ? "The instrument and shaping"
              : managed
                ? "Show or hide tracks"
                : "Instruments"
          }
          className={`inline-flex items-center gap-1.5 rounded-lg border py-2 pr-2 pl-2 transition-colors ${
            open
              ? "border-accent text-accent"
              : "border-line-strong text-muted hover:border-accent hover:text-accent"
          }`}
        >
          {single ? (
            <SlidersHorizontal className="size-4" aria-hidden="true" />
          ) : (
            <>
              <Layers className="size-4" aria-hidden="true" />
              <span className="font-mono text-faint text-xs">
                {managed
                  ? `${tracks.length - hidden.size}/${tracks.length}`
                  : tracks.length}
              </span>
            </>
          )}
        </span>
      )}
    >
      {shaped === null || onVoicing === null ? (
        <div data-tour="track-list" className="w-[19rem] max-sm:w-auto">
          <DotPulse
            notes={notes}
            getPosition={getPosition}
            dots={liveDots.current}
            hidden={hidden}
          />
          {tracks.map((track) => {
            const visible = !hidden.has(track.index);
            const claimed = mine.has(track.index);
            const color = trackColor(track.index);
            return (
              <div
                key={track.index}
                className="flex min-w-0 items-center gap-0.5"
              >
                {single || !managed ? (
                  <span className="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-2 text-left">
                    <span
                      ref={registerDot(track.index)}
                      className="track-dot size-2.5 shrink-0 rounded-full"
                      style={{
                        background: color.glow,
                        boxShadow: `0 0 10px ${color.glow}`,
                      }}
                    />
                    <span className="min-w-0 truncate text-sm">
                      {track.name}
                    </span>
                    {track.noteCount > 0 ? (
                      <span className="ml-auto shrink-0 font-mono text-faint text-[0.7rem]">
                        {track.noteCount}
                      </span>
                    ) : null}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onToggleVisible?.(track.index)}
                    aria-pressed={visible}
                    className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-raised"
                    style={{ opacity: visible ? 1 : 0.4 }}
                  >
                    <span
                      ref={registerDot(track.index)}
                      className="track-dot size-2.5 shrink-0 rounded-full"
                      style={{
                        background: visible ? color.glow : "transparent",
                        boxShadow: visible ? `0 0 10px ${color.glow}` : "none",
                        border: visible ? "none" : `1.5px solid ${color.glow}`,
                      }}
                    />
                    <span className="min-w-0 truncate text-sm">
                      {track.name}
                    </span>
                    {track.noteCount > 0 ? (
                      <span className="ml-auto shrink-0 font-mono text-faint text-[0.7rem]">
                        {track.noteCount}
                      </span>
                    ) : null}
                  </button>
                )}
                {managed && !single ? (
                  <button
                    type="button"
                    data-tour="track-solo"
                    onClick={() => onSolo?.(track.index)}
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
                ) : null}
                {managed && interactive && canClaim && !single ? (
                  <button
                    type="button"
                    data-tour="track-claim"
                    onClick={() => onToggleMine?.(track.index)}
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
                    data-tour="track-sound"
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
          {sound === null ||
          (!sound.dirty &&
            sound.playing === "" &&
            sound.others.length === 0) ? null : (
            <div className="mt-1 flex items-center gap-2 border-line border-t px-2 pt-2">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[0.7rem] text-faint leading-relaxed">
                  {sound.dirty
                    ? sound.canSave
                      ? "Yours, not saved"
                      : "Sign in to keep this"
                    : sound.playing === ""
                      ? "The sounds in the file"
                      : `Sound by ${sound.playing}`}
                </p>
                {sound.others.length === 0 ? null : (
                  <label className="mt-1 flex items-center gap-1.5 font-mono text-[0.7rem] text-faint">
                    <span className="sr-only">Whose sound to play</span>
                    <select
                      value=""
                      onChange={(event) => sound.onAdopt(event.target.value)}
                      className="min-w-0 flex-1 rounded-lg border border-line-strong bg-panel px-1.5 py-1 text-muted outline-none focus:border-accent"
                    >
                      <option value="">Hear someone else's</option>
                      {sound.others.map((author) => (
                        <option key={author.id} value={author.id}>
                          {author.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
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

/** Pulses the track dots straight from the playback clock rather than React
 * state, so the list keeps pace with the roll without re-rendering. It lives
 * inside the open menu, so the loop only runs while the dots are on screen. */
function DotPulse({
  notes,
  getPosition,
  dots,
  hidden,
}: {
  notes: readonly SongNote[];
  getPosition: () => number;
  dots: Map<number, HTMLSpanElement>;
  hidden: ReadonlySet<number>;
}): null {
  useEffect(() => {
    // A short note only sounds for a frame or two, so each channel is held lit
    // briefly past its last note for the pulse to register.
    const holdMs = 260;
    const litUntil = new Map<number, number>();
    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (now - last < 40) {
        return;
      }
      last = now;
      for (const index of soundingTracks(notes, getPosition(), hidden)) {
        litUntil.set(index, now + holdMs);
      }
      for (const [index, node] of dots) {
        node.toggleAttribute("data-live", (litUntil.get(index) ?? 0) > now);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [notes, getPosition, dots, hidden]);
  return null;
}
