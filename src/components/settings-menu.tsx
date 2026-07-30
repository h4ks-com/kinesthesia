"use client";

import { Settings2 } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Popover } from "@/components/ui/popover";
import { SliderRow } from "@/components/ui/slider-row";
import { Toggle } from "@/components/ui/toggle";
import { latencyRange } from "@/lib/audio/latency";
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
  /** Where the player's own hits say the offset should sit, once enough of them
   * have been timed. Null while they say nothing. */
  suggestedLatency: number | null;
  showLatency: boolean;
  /** Null on a device with no pointer fine enough to imply a keyboard, where
   * lettering the keys would only be clutter. */
  keyLabels: boolean | null;
  onKeyLabels: (show: boolean) => void;
  plainStyle: boolean;
  /** Null where a mode has no skin to offer. */
  onPickSkin: (() => void) | null;
  skinName: string | null;
  /** Null where the notes have to be read coming and cannot be turned
   * around. */
  onRising: ((rising: boolean) => void) | null;
  rising: boolean;
  /** The background that decides the direction on its own, where one does.
   * Named so the row can say why it will not move. */
  risingHeldBy: string | null;
  onPlainStyle: (plain: boolean) => void;
};

export function SettingsMenu({
  keyWidth,
  onKeyWidth,
  octave,
  onOctave,
  inputStatus,
  latencyOffset,
  onLatencyOffset,
  suggestedLatency,
  showLatency,
  keyLabels,
  onKeyLabels,
  plainStyle,
  onPickSkin,
  skinName,
  onRising,
  rising,
  risingHeldBy,
  onPlainStyle,
}: SettingsMenuProps) {
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
      {(close) => (
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
          </Section>

          <Section title="Style">
            <Toggle
              label="disable effects"
              checked={plainStyle}
              onChange={onPlainStyle}
              tip="Flat colour, no glow, no sparks and no background. Calmer to read, and lighter on a slow device."
            />
            {onRising === null ? null : (
              <Toggle
                label="notes rise"
                checked={rising}
                onChange={onRising}
                disabled={plainStyle || risingHeldBy !== null}
                tip={
                  risingHeldBy === null
                    ? "Sends the notes out of the keys as they sound instead of onto them. A look, not a way to read ahead."
                    : `${risingHeldBy} only reads with the notes going this way. Pick another background to turn them around.`
                }
              />
            )}
            {onPickSkin === null ? null : (
              <button
                type="button"
                disabled={plainStyle}
                onClick={() => {
                  close();
                  onPickSkin();
                }}
                data-tip="What is drawn behind the notes"
                data-tip-side="left"
                className="flex w-full items-center justify-between rounded-lg px-1 py-1.5 font-mono text-muted text-xs transition-colors hover:text-accent disabled:cursor-not-allowed disabled:text-faint disabled:hover:text-faint"
              >
                <span>background</span>
                <span className="text-faint">
                  {plainStyle ? "off" : skinName}
                </span>
              </button>
            )}
          </Section>

          {keyLabels === null ? null : (
            <Section title="Keyboard">
              <Toggle
                label="letters on keys"
                checked={keyLabels}
                onChange={onKeyLabels}
                tip="Prints the computer key that plays each piano key, for the octave under your hands."
              />
            </Section>
          )}

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
            <Section title="Timing">
              <SliderRow
                ariaLabel="Timing offset in milliseconds"
                min={latencyRange.min}
                max={latencyRange.max}
                step={5}
                value={latencyOffset}
                valueText={`${latencyOffset > 0 ? "+" : ""}${latencyOffset}ms`}
                onChange={onLatencyOffset}
              />
              {suggestedLatency === null ? (
                <Note>
                  Your device's own delay is not measured. Raise this if your
                  playing scores late.
                </Note>
              ) : (
                <Note>
                  Your hits are landing{" "}
                  {Math.abs(suggestedLatency - latencyOffset)}ms{" "}
                  {suggestedLatency > latencyOffset ? "late" : "early"}.{" "}
                  <button
                    type="button"
                    className="underline underline-offset-2 hover:text-bright"
                    onClick={() => onLatencyOffset(suggestedLatency)}
                  >
                    Set the offset to {suggestedLatency}ms
                  </button>
                </Note>
              )}
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
      )}
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
