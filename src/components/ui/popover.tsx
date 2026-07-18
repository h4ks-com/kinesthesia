"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

type PopoverProps = {
  trigger: (open: boolean) => ReactNode;
  children: ReactNode;
  align?: "left" | "right";
  side?: "top" | "bottom";
  label: string;
};

export function Popover({
  trigger,
  children,
  align = "right",
  side = "bottom",
  label,
}: PopoverProps) {
  const [open, setOpen] = useState(false);
  const shell = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) {
        return;
      }
      if (shell.current !== null && !shell.current.contains(event.target)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={shell} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((current) => !current)}
        className="inline-flex rounded-lg"
      >
        {trigger(open)}
      </button>
      {open ? (
        <div
          className={`rise absolute z-50 max-h-[70vh] overflow-auto rounded-xl border border-line-strong bg-panel p-1.5 shadow-[0_20px_60px_-12px_rgba(0,0,0,0.9)] ${
            align === "right" ? "right-0" : "left-0"
          } ${
            side === "top" ? "bottom-[calc(100%+8px)]" : "top-[calc(100%+8px)]"
          } max-sm:fixed max-sm:inset-x-3 max-sm:right-auto max-sm:left-3 max-sm:w-auto ${
            side === "top" ? "max-sm:bottom-20" : "max-sm:top-16"
          }`}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
