"use client";

import { Cable, Check, X } from "lucide-react";
import { type ReactNode, type Ref, useEffect, useRef, useState } from "react";
import { AddedBackgrounds } from "@/components/added-backgrounds";
import { CustomBackgrounds } from "@/components/custom-backgrounds";
import {
  bindingFor,
  type ControlRef,
  type MidiShortcuts,
  sameTarget,
  sliderBinding,
} from "@/lib/input/midi-shortcuts";
import type { BackgroundChoice } from "@/lib/skins/backdrop";
import type {
  BackdropSource,
  Skin,
  SkinId,
  SkinInstance,
} from "@/lib/skins/types";
import { useNearby } from "@/lib/use-nearby";

type SkinPickerProps = {
  chosen: BackgroundChoice | null;
  /** Decided by the caller, which is the only place that knows which of these
   * read the way its notes travel. */
  available: readonly Skin[];
  /** Applied at once so the roll behind shows it. Picking a picture leaves the
   * dialog up, since it is only half the choice: the rest is shaping it. */
  onChoose: (next: BackgroundChoice | null) => void;
  onClose: () => void;
  /** Null where the caller has no MIDI surface, and the tiles read as they did. */
  shortcuts: MidiShortcuts | null;
};

/** How a skin looks in the preview, with note heads climbing so a skin that
 * answers to them has something to answer to. */
const previewTravellers = [0.28, 0.52, 0.74];

/** Roughly three landings a second, without a clock to remember between
 * frames: the tile only has to look alive. */
function beat(elapsed: number): boolean {
  return Math.floor(elapsed * 3) !== Math.floor((elapsed - 1 / 60) * 3);
}

/** Runs one skin small, so the choice is made by looking rather than by name.
 * A skin the device cannot run reports it, so the tile can refuse the choice
 * rather than accepting one that quietly does nothing. Both ways it can fail
 * arrive here: no drawing context at all, and a worker that starts and then
 * says it cannot go on, which is what a device without WebGL2 gives. */
export function Preview({
  source,
  onUnsupported,
}: {
  source: BackdropSource;
  onUnsupported?: () => void;
}) {
  const base = useRef<HTMLCanvasElement | null>(null);
  const overlay = useRef<HTMLCanvasElement | null>(null);
  const refuse = useRef(onUnsupported);
  refuse.current = onUnsupported;

  useEffect(() => {
    const under = base.current;
    const over = overlay.current;
    if (under === null || over === null) {
      return;
    }
    const made = source.create({ base: under, overlay: over }, () =>
      refuse.current?.(),
    );
    if (made === null) {
      refuse.current?.();
      return;
    }
    const instance: SkinInstance = made;
    const box = under.getBoundingClientRect();
    instance.resize(box.width, box.height, 1);
    const started = performance.now();
    let frame = requestAnimationFrame(function loop() {
      const elapsed = (performance.now() - started) / 1000;
      instance.draw({
        // No song to read, so the preview's own clock stands in for one and a
        // travelling picture still travels.
        position: elapsed,
        keyboardTop: box.height,
        elapsed,
        travellers: previewTravellers.map((across, index) => ({
          x: box.width * across,
          y: box.height * (0.9 - ((elapsed * 0.32 + index * 0.31) % 1)),
          radius: 7,
          color: index === 1 ? "#f0a93a" : "#35d6a4",
          pitch: 60,
          velocity: 0.8,
        })),
        // A landing every so often, so a skin that only answers to strikes has
        // something to show in its tile.
        strikes: beat(elapsed)
          ? [
              {
                x: box.width * (0.2 + Math.random() * 0.6),
                color: "#35d6a4",
                pitch: 60,
                velocity: 0.8,
              },
            ]
          : [],
        step: 1 / 60,
        pressed: [],
        chord: null,
        key: null,
      });
      frame = requestAnimationFrame(loop);
    });
    return () => {
      cancelAnimationFrame(frame);
      instance.dispose();
    };
  }, [source]);

  return (
    <span className="relative block h-24 w-full overflow-hidden rounded-lg bg-void">
      <canvas ref={base} className="absolute inset-0 block size-full" />
      <canvas ref={overlay} className="absolute inset-0 block size-full" />
    </span>
  );
}

/** What no background looks like, drawn the same size as a live preview so the
 * first choice reads as a choice rather than as a gap above the others. */
function Flat() {
  return (
    <span
      aria-hidden="true"
      className="block h-24 w-full rounded-lg bg-void ring-1 ring-line ring-inset"
    />
  );
}

/** A control's name as it sits in a badge: a channel controller by its number,
 * a Yamaha slider by the address it reports. */
function controlLabel(control: ControlRef): string {
  if (control.kind === "cc") {
    return `CC ${control.controller} · ch${control.channel}`;
  }
  const address = control.key
    .slice(-3)
    .map((byte) => byte.toString(16).padStart(2, "0").toUpperCase())
    .join(" ");
  return `sysex ${address}`;
}

/** The controller button a background is bound to, or the way to bind one. It
 * sits below the tile rather than inside it: its own buttons would be swallowed
 * by the tile's click. */
function MidiBinding({
  target,
  shortcuts,
}: {
  target: BackgroundChoice | null;
  shortcuts: MidiShortcuts;
}) {
  const binding = bindingFor(shortcuts.bindings, target);
  const learning = shortcuts.learning;
  const learningThis =
    learning?.kind === "button" && sameTarget(learning.target, target);

  if (learningThis) {
    return (
      <div className="flex flex-col gap-1 px-0.5">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 font-mono text-accent text-xs">
            <span className="size-1.5 animate-ping rounded-full bg-accent" />
            waiting for a midi event
          </span>
          <button
            type="button"
            onClick={shortcuts.cancelLearn}
            aria-label="Cancel binding"
            className="text-faint transition-colors hover:text-text"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
        {shortcuts.conflict === null ? null : (
          <p className="text-danger text-xs">
            {shortcuts.conflict === "reserved"
              ? "That one is used while playing."
              : "That control already switches another background."}
          </p>
        )}
      </div>
    );
  }

  if (binding !== null && binding.kind === "button") {
    return (
      <div className="flex items-center justify-between px-0.5">
        <button
          type="button"
          onClick={() => shortcuts.beginLearnButton(target)}
          data-tip="Bind a different control"
          data-tip-side="bottom"
          className="inline-flex items-center gap-1 font-mono text-faint text-xs transition-colors hover:text-accent"
        >
          <Cable className="size-3" aria-hidden="true" />
          {controlLabel(binding.control)}
        </button>
        <button
          type="button"
          onClick={() => shortcuts.clearButton(binding.control)}
          aria-label="Clear binding"
          data-tip="Clear"
          data-tip-side="bottom"
          className="text-faint transition-colors hover:text-danger"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => shortcuts.beginLearnButton(target)}
      aria-label="Assign a MIDI control event to this background"
      data-tip="Assign a MIDI control event to this background"
      data-tip-side="bottom"
      className="self-start rounded-md p-1 text-faint transition-colors hover:text-accent"
    >
      <Cable className="size-3.5" aria-hidden="true" />
    </button>
  );
}

/** One slider spread across every background, so a single control reaches them
 * all by where it sits in its travel. It owns the whole set rather than a tile,
 * so it lives at the foot of the picker. */
function SliderBinding({ shortcuts }: { shortcuts: MidiShortcuts }) {
  const slider = sliderBinding(shortcuts.bindings);
  const learning = shortcuts.learning?.kind === "slider";

  if (learning) {
    return (
      <div className="flex items-center gap-2">
        <span
          className="inline-flex items-center gap-1.5 font-mono text-accent text-xs"
          data-tip="Move the control across its whole travel so its range is read."
          data-tip-side="top"
        >
          <span className="size-1.5 animate-ping rounded-full bg-accent" />
          move the control…
        </span>
        <button
          type="button"
          onClick={shortcuts.cancelLearn}
          aria-label="Cancel"
          data-tip="Cancel"
          data-tip-side="top"
          className="text-faint transition-colors hover:text-text"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </div>
    );
  }

  if (slider !== null && slider.kind === "slider") {
    return (
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={shortcuts.beginLearnSlider}
          aria-label={`Reassign the background control, currently ${controlLabel(slider.control)}`}
          data-tip={`Reassign the background control (${controlLabel(slider.control)})`}
          data-tip-side="top"
          className="inline-flex items-center gap-1 rounded-md p-1 text-faint transition-colors hover:text-accent"
        >
          <Cable className="size-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={shortcuts.clearSlider}
          aria-label="Clear the background control"
          data-tip="Clear the background control"
          data-tip-side="top"
          className="rounded-md p-1 text-faint transition-colors hover:text-danger"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={shortcuts.beginLearnSlider}
      aria-label="Assign a continuous control to scroll through every background"
      data-tip="Assign a continuous control to scroll through every background"
      data-tip-side="top"
      className="rounded-md p-1 text-faint transition-colors hover:text-accent"
    >
      <Cable className="size-3.5" aria-hidden="true" />
    </button>
  );
}

export function Choice({
  title,
  blurb,
  selected,
  disabled = false,
  onSelect,
  children,
  ref,
  target,
  shortcuts,
}: {
  title: string;
  blurb: string;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
  children?: ReactNode;
  /** The tile itself, for a caller that only wants to run a preview once it is
   * near enough to be looked at. A wrapper would not do: a grid item laid out
   * with display:contents generates no box, and a box is what can be watched
   * for. */
  ref?: Ref<HTMLDivElement>;
  /** The background this tile picks, so it can be bound to a controller button.
   * Null where the tile clears the background. */
  target: BackgroundChoice | null;
  /** Null where the caller has no MIDI surface, and the tile reads as it did. */
  shortcuts: MidiShortcuts | null;
}) {
  return (
    <div
      ref={ref}
      className={`flex flex-col gap-2 rounded-xl border p-2.5 transition-colors ${
        disabled ? "cursor-not-allowed opacity-50" : ""
      } ${
        selected
          ? "border-accent bg-accent-soft/20"
          : "border-line hover:border-line-strong"
      }`}
    >
      <button
        type="button"
        // Refused rather than disabled: a disabled button leaves the tab order,
        // and the dialog's own trap skips it, so the one person who most needs
        // to hear why a background is unavailable is the one who never reaches
        // it. This stays focusable and says so.
        onClick={disabled ? undefined : onSelect}
        aria-disabled={disabled}
        aria-pressed={selected}
        className="flex flex-col gap-2 text-left"
      >
        {children}
        <div className="flex items-start gap-2 px-0.5">
          <span className="flex-1">
            <span className="flex items-center gap-1.5 font-medium text-sm text-text">
              {title}
              {selected ? (
                <Check className="size-3.5 text-accent" aria-hidden="true" />
              ) : null}
            </span>
            <span className="mt-0.5 block text-muted text-xs leading-relaxed">
              {blurb}
            </span>
          </span>
        </div>
      </button>
      {shortcuts !== null ? (
        <MidiBinding target={target} shortcuts={shortcuts} />
      ) : null}
    </div>
  );
}

/** One shipped background, run only once its tile is near enough to be looked
 * at. A shader preview holds a WebGL context, and a browser keeps only so many
 * of those at once before it starts dropping the oldest, which is a tile that
 * quietly stops drawing. */
function BuiltInTile({
  skin,
  chosen,
  unsupported,
  onUnsupported,
  onChoose,
  onClose,
  shortcuts,
}: {
  skin: Skin;
  chosen: BackgroundChoice | null;
  unsupported: boolean;
  onUnsupported: () => void;
  onChoose: (next: BackgroundChoice) => void;
  onClose: () => void;
  shortcuts: MidiShortcuts | null;
}) {
  const holder = useRef<HTMLDivElement | null>(null);
  const near = useNearby(holder);

  return (
    <Choice
      ref={holder}
      title={skin.name}
      blurb={unsupported ? "Does not run here." : skin.blurb}
      selected={chosen?.kind === "built-in" && chosen.id === skin.id}
      disabled={unsupported}
      onSelect={() => {
        onChoose({ kind: "built-in", id: skin.id });
        onClose();
      }}
      target={{ kind: "built-in", id: skin.id }}
      shortcuts={shortcuts}
    >
      {near && !unsupported ? (
        <Preview source={skin} onUnsupported={onUnsupported} />
      ) : (
        <span className="block h-24 w-full rounded-lg bg-void" />
      )}
    </Choice>
  );
}

export function SkinPicker({
  chosen,
  available,
  onChoose,
  onClose,
  shortcuts,
}: SkinPickerProps) {
  const dialog = useRef<HTMLDivElement | null>(null);
  const [unsupported, setUnsupported] = useState<ReadonlySet<SkinId>>(
    new Set(),
  );

  useEffect(() => {
    const opener = document.activeElement;
    dialog.current?.focus();
    // Captured and swallowed: the keys behind this play notes and toggle
    // playback, and aria-modal promises they are out of reach.
    const onKey = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === "Escape") {
        onClose();
      } else if (event.key === "Tab") {
        const focusable = dialog.current?.querySelectorAll<HTMLElement>(
          "button:not([disabled])",
        );
        const first = focusable?.[0];
        const last = focusable?.[focusable.length - 1];
        if (first === undefined || last === undefined) {
          return;
        }
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      if (opener instanceof HTMLElement) {
        opener.focus();
      }
    };
  }, [onClose]);

  // The learning state outlives this dialog, so closing it any way at all frees
  // it: otherwise the next open would still be listening for an event.
  const cancelLearn = shortcuts?.cancelLearn;
  useEffect(
    () => (cancelLearn === undefined ? undefined : () => cancelLearn()),
    [cancelLearn],
  );

  return (
    // The overlay scrolls rather than the dialog, so the dialog never clips a
    // tooltip: a hint over a tile at the edge reads over the backdrop instead of
    // being cut off, and the dialog itself can never grow a scrollbar.
    <div className="fixed inset-0 z-[60] overflow-y-auto overflow-x-hidden bg-void/70 backdrop-blur">
      {/* The way out for anyone who opened this to look. Hidden from assistive
          technology, which has Escape and the close button already. */}
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />
      <div className="relative flex min-h-full items-center justify-center p-4 pointer-events-none">
        <div
          ref={dialog}
          role="dialog"
          aria-modal="true"
          aria-label="Background"
          tabIndex={-1}
          className="pointer-events-auto relative w-full max-w-3xl rounded-2xl border border-line-strong bg-panel p-4 shadow-2xl outline-none"
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold text-lg text-text">Background</h2>
              <p className="mt-0.5 text-muted text-xs leading-relaxed">
                Drawn behind the notes, never over them.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-lg p-1.5 text-faint transition-colors hover:bg-raised hover:text-text"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>

          <CustomBackgrounds chosen={chosen} onChoose={onChoose} />

          <div className="mt-4 mb-2.5 flex items-center justify-between gap-2">
            <h3 className="font-semibold text-sm text-text">Default skins</h3>
            {shortcuts === null ? null : (
              <SliderBinding shortcuts={shortcuts} />
            )}
          </div>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            <Choice
              title="No background"
              blurb="A flat dark backdrop. Nothing moves behind the notes."
              selected={chosen === null}
              onSelect={() => {
                onChoose(null);
                onClose();
              }}
              target={null}
              shortcuts={shortcuts}
            >
              <Flat />
            </Choice>
            {available.map((skin) => (
              <BuiltInTile
                key={skin.id}
                skin={skin}
                chosen={chosen}
                unsupported={unsupported.has(skin.id)}
                onUnsupported={() =>
                  setUnsupported((known) => new Set(known).add(skin.id))
                }
                onChoose={onChoose}
                onClose={onClose}
                shortcuts={shortcuts}
              />
            ))}
          </div>

          <AddedBackgrounds
            chosen={chosen}
            onChoose={onChoose}
            onClose={onClose}
            shortcuts={shortcuts}
          />
        </div>
      </div>
    </div>
  );
}
