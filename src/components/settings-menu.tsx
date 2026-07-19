"use client";

import { Settings2 } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Popover } from "@/components/ui/popover";
import { SliderRow } from "@/components/ui/slider-row";
import { latencyAdvice, latencyRange } from "@/lib/audio/latency";
import type { InputStatus } from "@/lib/input/use-note-input";
import { keyWidthRange } from "@/lib/render/keyboard";

/** What this device does with the song, not what the song is: the part itself
 * lives in the header, where both sides of a match show it the same way. */
type SettingsMenuProps = {
  keyWidth: number;
  onKeyWidth: (width: number) => void;
  octave: number | null;
  onOctave: (octave: number) => void;
  inputStatus: InputStatus;
  latencyOffset: number;
  onLatencyOffset: (value: number) => void;
  measuredLatency: number;
  showLatency: boolean;
};

export function SettingsMenu({
  keyWidth,
  onKeyWidth,
  octave,
  onOctave,
  inputStatus,
  latencyOffset,
  onLatencyOffset,
  measuredLatency,
  showLatency,
}: SettingsMenuProps) {
  const advice = latencyAdvice(measuredLatency);

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
          className={`inline-flex items-center rounded-lg border p-2 transition-colors ${
            open
              ? "border-accent text-accent"
              : "border-line-strong text-muted hover:border-accent hover:text-accent"
          }`}
        >
          <Settings2 className="size-3.5" aria-hidden="true" />
        </span>
      )}
    >
      <div className="flex w-56 flex-col gap-2 p-1 max-sm:w-full">
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
