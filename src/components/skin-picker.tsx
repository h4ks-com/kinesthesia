"use client";

import { Check, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { CustomBackgrounds } from "@/components/custom-backgrounds";
import type { BackgroundChoice } from "@/lib/skins/backdrop";
import type {
  BackdropSource,
  Skin,
  SkinId,
  SkinInstance,
} from "@/lib/skins/types";

type SkinPickerProps = {
  chosen: BackgroundChoice | null;
  /** Decided by the caller, which is the only place that knows which of these
   * read the way its notes travel. */
  available: readonly Skin[];
  /** Applied at once so the roll behind shows it. Picking a picture leaves the
   * dialog up, since it is only half the choice: the rest is shaping it. */
  onChoose: (next: BackgroundChoice | null) => void;
  onClose: () => void;
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
 * rather than accepting one that quietly does nothing. */
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
    const made = source.create({ base: under, overlay: over });
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
        })),
        // A landing every so often, so a skin that only answers to strikes has
        // something to show in its tile.
        strikes: beat(elapsed)
          ? [{ x: box.width * (0.2 + Math.random() * 0.6), color: "#35d6a4" }]
          : [],
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

function Choice({
  title,
  blurb,
  selected,
  disabled = false,
  onSelect,
  children,
}: {
  title: string;
  blurb: string;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
      className={`flex flex-col gap-2 rounded-xl border p-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        selected
          ? "border-accent bg-accent-soft/20"
          : "border-line hover:border-line-strong"
      }`}
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
  );
}

export function SkinPicker({
  chosen,
  available,
  onChoose,
  onClose,
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

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-void/70 p-4 backdrop-blur">
      {/* The way out for anyone who opened this to look. Hidden from assistive
          technology, which has Escape and the close button already. */}
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Background"
        tabIndex={-1}
        className="relative max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-line-strong bg-panel p-4 shadow-2xl outline-none"
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

        <h3 className="mt-4 mb-2.5 font-semibold text-sm text-text">
          The ones that come with it
        </h3>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          <Choice
            title="No background"
            blurb="A flat dark backdrop. Nothing moves behind the notes."
            selected={chosen === null}
            onSelect={() => {
              onChoose(null);
              onClose();
            }}
          >
            <Flat />
          </Choice>
          {available.map((skin) => (
            <Choice
              key={skin.id}
              title={skin.name}
              blurb={unsupported.has(skin.id) ? "Needs WebGL2." : skin.blurb}
              selected={chosen?.kind === "built-in" && chosen.id === skin.id}
              disabled={unsupported.has(skin.id)}
              onSelect={() => {
                onChoose({ kind: "built-in", id: skin.id });
                onClose();
              }}
            >
              <Preview
                source={skin}
                onUnsupported={() =>
                  setUnsupported((known) => new Set(known).add(skin.id))
                }
              />
            </Choice>
          ))}
        </div>
      </div>
    </div>
  );
}
