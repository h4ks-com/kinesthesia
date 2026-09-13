"use client";

import { useEffect, useRef, useState } from "react";

type ConfirmButtonProps = {
  label: string;
  ariaLabel: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
};

/** A destructive action behind a short confirm panel, so a clear cannot happen
 * on a single stray click. */
export function ConfirmButton({
  label,
  ariaLabel,
  message,
  confirmLabel,
  onConfirm,
}: ConfirmButtonProps) {
  const [open, setOpen] = useState(false);
  const shell = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        shell.current !== null &&
        !shell.current.contains(event.target)
      ) {
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
        onClick={() => setOpen((current) => !current)}
        aria-label={ariaLabel}
        data-tip={ariaLabel}
        className={`rounded-md px-2 py-1 font-mono text-xs transition-colors ${
          open ? "text-danger" : "text-faint hover:text-danger"
        }`}
      >
        {label}
      </button>
      {open ? (
        <div className="absolute right-0 z-50 mt-1 w-52 rounded-lg border border-line-strong bg-raised p-3 shadow-xl">
          <p className="mb-2.5 text-text text-xs">{message}</p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md px-2 py-1 font-mono text-faint text-xs transition-colors hover:text-text"
            >
              cancel
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                void onConfirm();
              }}
              className="rounded-md border border-danger/50 px-2 py-1 font-mono text-danger text-xs transition-colors hover:bg-danger/10"
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
