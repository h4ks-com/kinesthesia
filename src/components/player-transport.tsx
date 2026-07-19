"use client";

import { Gauge, Music4, Pause, Play } from "lucide-react";
import { SettingsMenu } from "@/components/settings-menu";
import { Popover } from "@/components/ui/popover";
import { SliderRow } from "@/components/ui/slider-row";
import { formatClock } from "@/lib/format/clock";
import type { InputStatus } from "@/lib/input/use-note-input";
import {
  clampTranspose,
  defaultTranspose,
  formatTranspose,
  type Transpose,
  transposeRange,
} from "@/lib/midi/song";
import { defaultSpeed, type Speed, speeds } from "@/lib/player-url";

type PlayerTransportProps = {
  playing: boolean;
  elapsed: number;
  duration: number;
  speed: Speed;
  /** Null while the speed is fixed: a match runs both sides at one tempo. */
  onSpeed: ((speed: Speed) => void) | null;
  transpose: Transpose;
  /** Null while the key is fixed, for the same reason the tempo is. */
  onTranspose: ((semitones: Transpose) => void) | null;
  keyWidth: number;
  onKeyWidth: (width: number) => void;
  octave: number | null;
  inputStatus: InputStatus;
  latencyOffset: number;
  onLatencyOffset: (value: number) => void;
  measuredLatency: number;
  showLatency: boolean;
  /** Null once a round owns the clock, leaving the bar to report it. */
  onToggle: (() => void) | null;
  onSeek: ((position: number) => void) | null;
  onOctave: (octave: number) => void;
};

export function PlayerTransport({
  playing,
  elapsed,
  duration,
  speed,
  onSpeed,
  transpose,
  onTranspose,
  keyWidth,
  onKeyWidth,
  octave,
  inputStatus,
  latencyOffset,
  onLatencyOffset,
  measuredLatency,
  showLatency,
  onToggle,
  onSeek,
  onOctave,
}: PlayerTransportProps) {
  return (
    <>
      {onToggle === null ? null : (
        <button
          type="button"
          data-tour="play"
          onClick={onToggle}
          data-tip={playing ? "Pause (space)" : "Play (space)"}
          data-tip-side="top"
          data-tip-align="left"
          aria-label={playing ? "Pause" : "Play"}
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent text-void shadow-[0_0_24px_-6px_var(--accent)] transition-transform hover:scale-105 active:scale-95"
        >
          {playing ? (
            <Pause className="size-5 fill-current" aria-hidden="true" />
          ) : (
            <Play
              className="size-5 translate-x-px fill-current"
              aria-hidden="true"
            />
          )}
        </button>
      )}

      <span className="shrink-0 font-mono text-muted text-xs tabular-nums">
        {formatClock(elapsed)}
        <span className="hidden text-faint sm:inline">
          {" "}
          / {formatClock(duration)}
        </span>
      </span>

      <input
        type="range"
        min={0}
        max={Math.max(1, duration)}
        step={1}
        value={Math.min(elapsed, duration)}
        disabled={onSeek === null}
        onChange={(event) => onSeek?.(Number(event.target.value))}
        aria-label="Song position"
        aria-valuetext={formatClock(elapsed)}
        className="min-w-0 flex-1 disabled:opacity-50"
      />

      {onSpeed === null ? null : (
        <div className="shrink-0" data-tour="speed">
          <Popover
            label={`Speed, ${speed}x`}
            side="top"
            align="right"
            clearance="keyboard"
            trigger={(open) => (
              <span
                data-tip="Playback speed"
                data-tip-side="top"
                data-tip-align="right"
                className={`inline-flex items-center gap-1.5 rounded-lg border p-2 font-mono text-xs transition-colors ${
                  open || speed !== defaultSpeed
                    ? "border-accent text-accent"
                    : "border-line-strong text-muted hover:border-accent hover:text-accent"
                }`}
              >
                <Gauge className="size-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">{speed}x</span>
              </span>
            )}
          >
            <div className="w-56 p-1 max-sm:w-full">
              <h3 className="label px-2">Speed</h3>
              <SliderRow
                ariaLabel="Playback speed"
                min={0}
                max={speeds.length - 1}
                step={1}
                value={speeds.indexOf(speed)}
                valueText={`${speed}x`}
                onChange={(index) => onSpeed(speeds[index] ?? defaultSpeed)}
              />
              <p className="px-2 pb-1 font-mono text-[0.7rem] text-faint leading-relaxed">
                Both sides of a match run at this tempo.
              </p>
            </div>
          </Popover>
        </div>
      )}

      {onTranspose === null ? (
        transpose === defaultTranspose ? null : (
          <span
            data-tip="The host set this transpose"
            data-tip-side="top"
            data-tip-align="right"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-accent p-2 font-mono text-accent text-xs"
          >
            <Music4 className="size-3.5" aria-hidden="true" />
            <span className="sr-only">Transpose,</span>
            {formatTranspose(transpose)}
            <span className="sr-only">semitones</span>
          </span>
        )
      ) : (
        <div className="shrink-0" data-tour="transpose">
          <Popover
            label={`Transpose, ${formatTranspose(transpose)} semitones`}
            side="top"
            align="right"
            clearance="keyboard"
            trigger={(open) => (
              <span
                data-tip="Transpose"
                data-tip-side="top"
                data-tip-align="right"
                className={`inline-flex items-center gap-1.5 rounded-lg border p-2 font-mono text-xs transition-colors ${
                  open || transpose !== defaultTranspose
                    ? "border-accent text-accent"
                    : "border-line-strong text-muted hover:border-accent hover:text-accent"
                }`}
              >
                <Music4 className="size-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">
                  {formatTranspose(transpose)}
                </span>
              </span>
            )}
          >
            <div className="w-56 p-1 max-sm:w-full">
              <h3 className="label px-2">Transpose</h3>
              <SliderRow
                ariaLabel="Transpose in semitones"
                min={transposeRange.min}
                max={transposeRange.max}
                step={1}
                value={transpose}
                valueText={formatTranspose(transpose)}
                onChange={(value) => onTranspose(clampTranspose(value))}
              />
              <p className="px-2 pb-1 font-mono text-[0.7rem] text-faint leading-relaxed">
                Moves every instrument and both sides of a match. Drums keep
                their own sounds.
              </p>
            </div>
          </Popover>
        </div>
      )}

      <div className="shrink-0">
        <SettingsMenu
          keyWidth={keyWidth}
          onKeyWidth={onKeyWidth}
          octave={octave}
          onOctave={onOctave}
          inputStatus={inputStatus}
          latencyOffset={latencyOffset}
          onLatencyOffset={onLatencyOffset}
          measuredLatency={measuredLatency}
          showLatency={showLatency}
        />
      </div>
    </>
  );
}

/** The bar the transport sits in, so a match and a solo player frame it the
 * same way. */
export function TransportBar({ children }: { children: React.ReactNode }) {
  return (
    <footer className="flex h-16 shrink-0 items-center gap-3 border-line border-t bg-panel px-3 sm:gap-4 sm:px-4">
      {children}
    </footer>
  );
}
