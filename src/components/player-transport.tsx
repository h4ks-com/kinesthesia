"use client";

import { Pause, Play } from "lucide-react";
import { SettingsMenu } from "@/components/settings-menu";
import type { InputStatus } from "@/lib/input/use-note-input";
import type { Speed } from "@/lib/player-url";

function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

type PlayerTransportProps = {
  playing: boolean;
  elapsed: number;
  duration: number;
  speed: Speed;
  showSpeed: boolean;
  keyWidth: number;
  onKeyWidth: (width: number) => void;
  melodyRate: number;
  onMelodyRate: (rate: number) => void;
  onMelodyRateCommit: (rate: number) => void;
  showMelodyRate: boolean;
  octave: number | null;
  inputStatus: InputStatus;
  latencyOffset: number;
  onLatencyOffset: (value: number) => void;
  measuredLatency: number;
  showLatency: boolean;
  onToggle: () => void;
  onSeek: (position: number) => void;
  onSpeed: (speed: Speed) => void;
  onOctave: (octave: number) => void;
};

export function PlayerTransport({
  playing,
  elapsed,
  duration,
  speed,
  showSpeed,
  keyWidth,
  onKeyWidth,
  melodyRate,
  onMelodyRate,
  onMelodyRateCommit,
  showMelodyRate,
  octave,
  inputStatus,
  latencyOffset,
  onLatencyOffset,
  measuredLatency,
  showLatency,
  onToggle,
  onSeek,
  onSpeed,
  onOctave,
}: PlayerTransportProps) {
  return (
    <footer className="flex h-16 shrink-0 items-center gap-3 border-line border-t bg-panel px-3 sm:gap-4 sm:px-4">
      <button
        type="button"
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
        onChange={(event) => onSeek(Number(event.target.value))}
        aria-label="Song position"
        aria-valuetext={formatClock(elapsed)}
        className="min-w-0 flex-1"
      />

      <div className="shrink-0">
        <SettingsMenu
          speed={speed}
          onSpeed={onSpeed}
          showSpeed={showSpeed}
          keyWidth={keyWidth}
          onKeyWidth={onKeyWidth}
          melodyRate={melodyRate}
          onMelodyRate={onMelodyRate}
          onMelodyRateCommit={onMelodyRateCommit}
          showMelodyRate={showMelodyRate}
          octave={octave}
          onOctave={onOctave}
          inputStatus={inputStatus}
          latencyOffset={latencyOffset}
          onLatencyOffset={onLatencyOffset}
          measuredLatency={measuredLatency}
          showLatency={showLatency}
        />
      </div>
    </footer>
  );
}
