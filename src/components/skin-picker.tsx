"use client";

import { Check, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { skinsFor } from "@/lib/skins/registry";
import type {
  NoteDirection,
  Skin,
  SkinId,
  SkinInstance,
} from "@/lib/skins/types";

type SkinPickerProps = {
  chosen: SkinId;
  direction: NoteDirection;
  onChoose: (id: SkinId) => void;
  onClose: () => void;
};

/** How a skin looks in the preview, with note heads climbing so a skin that
 * answers to them has something to answer to. */
const previewTravellers = [0.28, 0.52, 0.74];

/** Runs one skin small, so the choice is made by looking rather than by name.
 * A skin the device cannot run says so in place of a picture. */
function Preview({ skin }: { skin: Skin }) {
  const base = useRef<HTMLCanvasElement | null>(null);
  const overlay = useRef<HTMLCanvasElement | null>(null);
  const [unsupported, setUnsupported] = useState(false);

  useEffect(() => {
    const under = base.current;
    const over = overlay.current;
    if (under === null || over === null) {
      return;
    }
    let made: SkinInstance | null = null;
    try {
      made = skin.create({ base: under, overlay: over });
    } catch {
      made = null;
    }
    if (made === null) {
      setUnsupported(true);
      return;
    }
    const instance = made;
    const box = under.getBoundingClientRect();
    instance.resize(box.width, box.height, 1);
    const started = performance.now();
    let frame = requestAnimationFrame(function loop() {
      const elapsed = (performance.now() - started) / 1000;
      instance.draw({
        width: box.width,
        height: box.height,
        keyboardTop: box.height,
        elapsed,
        direction: "up",
        travellers: previewTravellers.map((across, index) => ({
          x: box.width * across,
          y: box.height * (0.9 - ((elapsed * 0.32 + index * 0.31) % 1)),
          radius: 7,
          color: index === 1 ? "#f0a93a" : "#35d6a4",
        })),
        strikes: [],
      });
      frame = requestAnimationFrame(loop);
    });
    return () => {
      cancelAnimationFrame(frame);
      instance.dispose();
    };
  }, [skin]);

  if (unsupported) {
    return (
      <div className="flex h-24 items-center justify-center rounded-lg bg-void px-3 text-center font-mono text-[0.7rem] text-faint">
        this browser cannot run it
      </div>
    );
  }
  return (
    <span className="relative block h-24 w-full overflow-hidden rounded-lg bg-void">
      <canvas ref={base} className="absolute inset-0 block size-full" />
      <canvas ref={overlay} className="absolute inset-0 block size-full" />
    </span>
  );
}

function Choice({
  title,
  blurb,
  selected,
  onSelect,
  children,
}: {
  title: string;
  blurb: string;
  selected: boolean;
  onSelect: () => void;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex flex-col gap-2 rounded-xl border p-2.5 text-left transition-colors ${
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
  direction,
  onChoose,
  onClose,
}: SkinPickerProps) {
  const available = skinsFor(direction);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Background"
      className="fixed inset-0 z-50 flex items-center justify-center bg-void/70 p-4 backdrop-blur"
    >
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-line-strong bg-panel p-4 shadow-2xl">
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

        <div className="flex flex-col gap-2.5">
          <Choice
            title="Plain"
            blurb="The roll on its own."
            selected={chosen === "none"}
            onSelect={() => onChoose("none")}
          />
          {available.map((skin) => (
            <Choice
              key={skin.id}
              title={skin.name}
              blurb={skin.blurb}
              selected={chosen === skin.id}
              onSelect={() => onChoose(skin.id)}
            >
              <Preview skin={skin} />
            </Choice>
          ))}
          {available.length === 0 ? (
            <p className="px-1 py-2 text-muted text-xs">
              Nothing here suits the way these notes travel yet.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
