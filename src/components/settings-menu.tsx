"use client";

import { Settings2 } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Popover } from "@/components/ui/popover";
import { latencyAdvice, latencyRange } from "@/lib/audio/latency";
import type { InputStatus } from "@/lib/input/use-note-input";
import { melodyRateRange } from "@/lib/midi/melody";
import { defaultSpeed, type Speed, speeds } from "@/lib/player-url";
import { keyWidthRange } from "@/lib/render/keyboard";

type SettingsMenuProps = {
  speed: Speed;
  onSpeed: (speed: Speed) => void;
  showSpeed: boolean;
  keyWidth: number;
  onKeyWidth: (width: number) => void;
  melodyRate: number;
  onMelodyRate: (rate: number) => void;
  showMelodyRate: boolean;
  octave: number | null;
  onOctave: (octave: number) => void;
  inputStatus: InputStatus;
  latencyOffset: number;
  onLatencyOffset: (value: number) => void;
  measuredLatency: number;
  showLatency: boolean;
};

export function SettingsMenu({
  speed,
  onSpeed,
  showSpeed,
  keyWidth,
  onKeyWidth,
  melodyRate,
  onMelodyRate,
  showMelodyRate,
  octave,
  onOctave,
  inputStatus,
  latencyOffset,
  onLatencyOffset,
  measuredLatency,
  showLatency,
}: SettingsMenuProps) {
  const tweaked = speed !== defaultSpeed;
  const advice = latencyAdvice(measuredLatency);
  const speedIndex = speeds.indexOf(speed);

  return (
    <Popover
      label="Settings"
      side="top"
      align="right"
      clearance="keyboard"
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
      <div className="flex w-56 flex-col gap-2 p-1 max-sm:w-full">
        {showSpeed ? (
          <Section title="Speed">
            <SliderRow
              ariaLabel="Playback speed"
              min={0}
              max={speeds.length - 1}
              step={1}
              value={speedIndex}
              valueText={`${speed}x`}
              onChange={(index) => onSpeed(speeds[index] ?? defaultSpeed)}
            />
          </Section>
        ) : null}

        <Section title="Key size">
          <SliderRow
            ariaLabel="Piano key width"
            min={keyWidthRange.min}
            max={keyWidthRange.max}
            step={2}
            value={keyWidth}
            valueText={`${keyWidth}px`}
            onChange={onKeyWidth}
          />
          <Note>Widen the keys to tap them, then drag the roll sideways.</Note>
        </Section>

        {showMelodyRate ? (
          <Section title="Note speed">
            <SliderRow
              ariaLabel="Maximum notes per second"
              min={melodyRateRange.min}
              max={melodyRateRange.max}
              step={1}
              value={melodyRate}
              valueText={`${melodyRate}/sec`}
              onChange={onMelodyRate}
            />
            <Note>Lower keeps the peaks of the tune and drops the rest.</Note>
          </Section>
        ) : null}

        {octave === null ? null : (
          <Section title="Octave">
            <div className="flex items-center gap-1 px-1">
              <OctaveButton
                label="Lower octave"
                onClick={() => onOctave(octave - 1)}
              >
                lower
              </OctaveButton>
              <span className="w-8 text-center font-mono text-accent text-xs">
                {octave}
              </span>
              <OctaveButton
                label="Higher octave"
                onClick={() => onOctave(octave + 1)}
              >
                higher
              </OctaveButton>
            </div>
          </Section>
        )}

        {showLatency ? (
          <Section
            title="Timing"
            badge={
              <span
                className={`ml-auto font-mono text-[0.7rem] ${
                  advice === null ? "text-faint" : "text-danger"
                }`}
              >
                output {Math.round(measuredLatency * 1000)}ms
              </span>
            }
          >
            <SliderRow
              ariaLabel="Timing offset in milliseconds"
              min={latencyRange.min}
              max={latencyRange.max}
              step={5}
              value={latencyOffset}
              valueText={`${latencyOffset > 0 ? "+" : ""}${latencyOffset}ms`}
              onChange={onLatencyOffset}
            />
            <Note>{advice ?? "Raise it if your playing scores late."}</Note>
          </Section>
        ) : null}

        <Section title="Input">
          <p className="flex items-center gap-2 px-2 pb-1 font-mono text-[0.7rem] text-faint">
            <span
              aria-hidden="true"
              className={`size-2 shrink-0 rounded-full ${
                inputStatus === "midi"
                  ? "bg-good shadow-[0_0_8px_var(--good)]"
                  : "bg-warn shadow-[0_0_8px_var(--warn)]"
              }`}
            />
            {inputStatus === "midi"
              ? "midi device connected"
              : "computer keyboard"}
          </p>
        </Section>
      </div>
    </Popover>
  );
}

function Section({
  title,
  badge,
  children,
}: {
  title: string;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-1 border-line border-t pt-2 first:border-t-0 first:pt-0">
      <div className="flex items-baseline gap-2 px-2">
        <h3 className="label">{title}</h3>
        {badge}
      </div>
      {children}
    </section>
  );
}

function SliderRow({
  ariaLabel,
  min,
  max,
  step,
  value,
  valueText,
  onChange,
}: {
  ariaLabel: string;
  min: number;
  max: number;
  step: number;
  value: number;
  valueText: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex items-center gap-2 px-2">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={ariaLabel}
        aria-valuetext={valueText}
        className="min-w-0 flex-1"
      />
      <span
        aria-hidden="true"
        className="w-12 shrink-0 text-right font-mono text-accent text-xs tabular-nums"
      >
        {valueText}
      </span>
    </div>
  );
}

function OctaveButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      tone="ghost"
      onClick={onClick}
      aria-label={label}
      className="flex-1 py-1.5 font-mono text-xs pointer-coarse:min-h-11"
    >
      {children}
    </Button>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="px-2 pb-1 font-mono text-[0.7rem] text-faint leading-relaxed">
      {children}
    </p>
  );
}
