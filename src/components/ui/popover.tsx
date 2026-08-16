"use client";

import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

type PopoverProps = {
  trigger: (open: boolean) => ReactNode;
  /** Given a way to dismiss the panel, so a row that opens something bigger
   * does not leave the menu hanging over it. */
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: "left" | "right";
  side?: "top" | "bottom";
  /** Keeps the panel clear of what it would otherwise cover on a phone, where
   * it is pinned to the screen rather than to the trigger. */
  clearance?: "footer" | "keyboard";
  label: string;
};

const phoneMargin = 12;
const phoneBreakpoint = 640;

export function Popover({
  trigger,
  children,
  align = "right",
  side = "bottom",
  clearance = "footer",
  label,
}: PopoverProps) {
  const [open, setOpen] = useState(false);
  const shell = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

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
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // A phone pins the panel to the screen rather than the trigger, so the
  // header stays clear of a keyboard band or footer below it. That pin still
  // has to track which side of the trigger it opened from, or a panel near
  // one edge of a narrow header lands nowhere near the control that opened it.
  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    const reposition = () => {
      const panel = panelRef.current;
      const anchor = triggerRef.current;
      if (panel === null || anchor === null) {
        return;
      }
      if (window.innerWidth >= phoneBreakpoint) {
        panel.style.left = "";
        return;
      }
      const anchorRect = anchor.getBoundingClientRect();
      const panelWidth = panel.getBoundingClientRect().width;
      const raw =
        align === "right" ? anchorRect.right - panelWidth : anchorRect.left;
      const maxLeft = window.innerWidth - phoneMargin - panelWidth;
      const left = Math.min(
        Math.max(raw, phoneMargin),
        Math.max(maxLeft, phoneMargin),
      );
      panel.style.left = `${left}px`;
    };
    reposition();
    window.addEventListener("resize", reposition);
    return () => window.removeEventListener("resize", reposition);
  }, [open, align]);

  return (
    <div ref={shell} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={label}
        onClick={() => setOpen((current) => !current)}
        className="inline-flex rounded-lg"
      >
        {trigger(open)}
      </button>
      {open ? (
        <div
          ref={panelRef}
          className={`rise absolute z-50 max-h-[70vh] overflow-y-auto overflow-x-clip rounded-xl border border-line-strong bg-panel p-1.5 shadow-[0_20px_60px_-12px_rgba(0,0,0,0.9)] ${
            align === "right" ? "right-0" : "left-0"
          } ${
            side === "top" ? "bottom-[calc(100%+8px)]" : "top-[calc(100%+8px)]"
          } max-sm:fixed max-sm:right-auto max-sm:w-auto max-sm:max-w-[calc(100vw-1.5rem)] ${
            side === "bottom"
              ? "max-sm:top-16"
              : clearance === "keyboard"
                ? "max-sm:bottom-52"
                : "max-sm:bottom-20"
          }`}
        >
          {typeof children === "function"
            ? children(() => setOpen(false))
            : children}
        </div>
      ) : null}
    </div>
  );
}
