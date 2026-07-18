"use client";

import { Settings2 } from "lucide-react";
import { Popover } from "@/components/ui/popover";
import { latencyRange } from "@/lib/audio/latency";
import { defaultSpeed, speeds } from "@/lib/player-url";

type SettingsMenuProps = {
  speed: number;
  onSpeed: (speed: number) => void;
  showSpeed: boolean;
  octave: number | null;
  onOctave: (octave: number) => void;
  inputLabel: string;
  latencyOffset: number;
  onLatencyOffset: (value: number) => void;
  measuredLatency: number;
  showLatency: boolean;
};

export function SettingsMenu({
  speed,
  onSpeed,
  showSpeed,
  octave,
  onOctave,
  inputLabel,
  latencyOffset,
  onLatencyOffset,
  measuredLatency,
  showLatency,
}: SettingsMenuProps) {
  const tweaked = speed !== defaultSpeed;

  return (
    <Popover
      label="Settings"
      side="top"
      align="right"
      trigger={(open) => (
        <span
          data-tip="Settings"
          data-tip-side="top"
          data-tip-align="right"
          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-mono text-xs transition-colors ${
            open || tweaked
              ? "border-accent text-accent"
              : "border-line-strong text-muted hover:border-accent hover:text-accent"
          }`}
        >
          <Settings2 className="size-3.5" aria-hidden="true" />
          {tweaked ? `${speed}x` : "Setup"}
        </span>
      )}
    >
      <div className="w-56 p-1">
        {showSpeed ? (
          <section className="flex flex-col gap-1 pb-2">
            <h3 className="label px-2 pt-1">Speed</h3>
            <div className="grid grid-cols-3 gap-1 px-1">
              {speeds.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => onSpeed(option)}
                  aria-pressed={option === speed}
                  className={`rounded-lg py-1.5 font-mono text-xs transition-colors ${
                    option === speed
                      ? "bg-accent text-void"
                      : "text-muted hover:bg-raised hover:text-text"
                  }`}
                >
                  {option}x
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {octave === null ? null : (
          <section className="flex flex-col gap-1 border-line border-t pt-2">
            <h3 className="label px-2">Octave</h3>
            <div className="flex items-center gap-1 px-1">
              <button
                type="button"
                onClick={() => onOctave(octave - 1)}
                aria-label="Lower octave"
                className="flex-1 rounded-lg py-1.5 font-mono text-muted text-xs transition-colors hover:bg-raised hover:text-text"
              >
                lower
              </button>
              <span className="w-8 text-center font-mono text-accent text-xs">
                {octave}
              </span>
              <button
                type="button"
                onClick={() => onOctave(octave + 1)}
                aria-label="Higher octave"
                className="flex-1 rounded-lg py-1.5 font-mono text-muted text-xs transition-colors hover:bg-raised hover:text-text"
              >
                higher
              </button>
            </div>
            <p className="px-2 pt-1 font-mono text-[0.7rem] text-faint">
              {inputLabel}
            </p>
          </section>
        )}

        {showLatency ? (
          <section className="flex flex-col gap-1 border-line border-t pt-2">
            <div className="flex items-baseline gap-2 px-2">
              <h3 className="label">Timing</h3>
              <span className="ml-auto font-mono text-[0.7rem] text-faint">
                output {Math.round(measuredLatency * 1000)}ms
              </span>
            </div>
            <div className="flex items-center gap-2 px-2 pb-1">
              <input
                type="range"
                min={latencyRange.min}
                max={latencyRange.max}
                step={5}
                value={latencyOffset}
                onChange={(event) =>
                  onLatencyOffset(Number(event.target.value))
                }
                aria-label="Timing offset in milliseconds"
                className="h-1 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-line"
              />
              <span className="w-12 shrink-0 text-right font-mono text-accent text-xs">
                {latencyOffset > 0 ? "+" : ""}
                {latencyOffset}ms
              </span>
            </div>
            <p className="px-2 pb-1 font-mono text-[0.7rem] text-faint leading-relaxed">
              Raise it if your playing scores late.
            </p>
          </section>
        ) : null}
      </div>
    </Popover>
  );
}
