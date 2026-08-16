"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { TourStep } from "@/lib/tour/steps";

type WalkthroughProps = {
  steps: readonly TourStep[];
  /** Ends the tour, whether it was finished or skipped. */
  onClose: () => void;
};

/** How long a step waits for its control to lay out before it is given up as
 * absent. Long enough for a popover's entrance and a first paint of the
 * transport, short enough that a genuinely missing control does not hold the
 * tour still. */
const anchorFrames = 40;

const pad = 8;
const dialogWidth = 300;
const gap = 14;

type Placement = {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
};

type AnchorBox = {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
};

/** A `display: none` anchor is still in the DOM but has no box. A control a
 * mode hides on a phone counts as absent, so the tour skips its step. */
function shownAnchor(anchor: string): Element | null {
  const el = document.querySelector(`[data-tour="${anchor}"]`);
  return el !== null && el.getClientRects().length > 0 ? el : null;
}

/** The part of an anchor's box a reader can actually see: clipped by every
 * ancestor that scrolls or clips it, and by the viewport. A track list inside
 * a capped popover panel is taller than the panel that scrolls it, so its raw
 * box reaches past what is on screen, and the tour must not point at that. */
function visibleBox(el: Element): AnchorBox | null {
  const own = el.getBoundingClientRect();
  let top = own.top;
  let left = own.left;
  let right = own.right;
  let bottom = own.bottom;
  for (let node = el.parentElement; node !== null; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.overflowX === "visible" && style.overflowY === "visible") {
      continue;
    }
    const box = node.getBoundingClientRect();
    top = Math.max(top, box.top);
    left = Math.max(left, box.left);
    right = Math.min(right, box.right);
    bottom = Math.min(bottom, box.bottom);
  }
  top = Math.max(top, 0);
  left = Math.max(left, 0);
  right = Math.min(right, window.innerWidth);
  bottom = Math.min(bottom, window.innerHeight);
  const width = right - left;
  const height = bottom - top;
  return width > 0 && height > 0 ? { top, left, width, height } : null;
}

function triggerButton(anchor: string): HTMLButtonElement | null {
  return (
    document.querySelector(`[data-tour="${anchor}"]`)?.closest("button") ?? null
  );
}

function popoverOpen(anchor: string): boolean {
  return triggerButton(anchor)?.getAttribute("aria-expanded") === "true";
}

/** Toggles the popover a `data-tour` trigger controls, so the tour can reveal
 * what lives inside it and put it away again. */
function clickTrigger(anchor: string): void {
  triggerButton(anchor)?.click();
}

const minDialogHeight = 100;

/** Sits the dialog right below the spotlight, or above it when the space
 * below is too tight, whichever leaves it clear of the control it points at.
 * A popover's own scroll cap keeps its anchor from ever eating the whole
 * screen, so one side almost always has room; on the rare anchor tall enough
 * to leave neither side comfortable, the dialog shrinks to what is left and
 * scrolls internally rather than overlapping the control. On a phone the
 * dialog spans the full width instead of sitting centred under the anchor. */
function placeDialog(rect: AnchorBox, dialogHeight: number): Placement {
  const phone = window.innerWidth < 640;
  const width = phone ? window.innerWidth - gap * 2 : dialogWidth;

  const roomBelow = window.innerHeight - gap * 2 - (rect.top + rect.height);
  const roomAbove = rect.top - gap * 2;
  const useBelow = roomBelow >= dialogHeight || roomBelow >= roomAbove;
  const height = Math.min(
    dialogHeight,
    Math.max(minDialogHeight, useBelow ? roomBelow : roomAbove),
  );
  const top = useBelow
    ? rect.top + rect.height + gap
    : Math.max(gap, rect.top - gap - height);

  const left = phone
    ? gap
    : Math.min(
        Math.max(gap, rect.left + rect.width / 2 - width / 2),
        window.innerWidth - width - gap,
      );

  return { top, left, width, height };
}

export function Walkthrough({ steps, onClose }: WalkthroughProps) {
  const [live, setLive] = useState<readonly TourStep[]>([]);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<AnchorBox | null>(null);
  const [place, setPlace] = useState<Placement | null>(null);
  const dialog = useRef<HTMLDivElement | null>(null);
  const next = useRef<HTMLButtonElement | null>(null);
  const held = useRef<string | null>(null);
  const advanceRef = useRef<() => void>(() => {});

  // Every step is kept and each one is settled when it is reached. Deciding
  // the whole list up front drops a control that had not finished laying out
  // yet, which is a step silently missing from the tour for the rest of the
  // session; the per-step measure below is what skips one that never arrives.
  useLayoutEffect(() => {
    setLive(steps);
    setIndex(0);
  }, [steps]);

  const step = live[index] ?? null;

  useLayoutEffect(() => {
    if (step === null) {
      return;
    }
    const desired = step.open ?? null;
    if (
      held.current !== null &&
      held.current !== desired &&
      popoverOpen(held.current)
    ) {
      clickTrigger(held.current);
    }
    if (desired !== null && !popoverOpen(desired)) {
      clickTrigger(desired);
    }
    held.current = desired;
    // Opening a popover lands the anchor a render later, and a popover's own
    // entrance animation can leave it clipped to nothing for a frame, so the
    // box is chased across a few frames before the step is given up as empty.
    let frame = 0;
    let tries = 0;
    const measure = () => {
      const el = shownAnchor(step.anchor);
      const box = el === null ? null : visibleBox(el);
      if (box !== null) {
        setRect(box);
      } else if (tries++ < anchorFrames) {
        frame = requestAnimationFrame(measure);
      } else {
        advanceRef.current();
      }
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [step]);

  const opened = useRef(false);
  useLayoutEffect(() => {
    if (rect === null) {
      return;
    }
    // scrollHeight, not offsetHeight: a dialog already capped to a previous
    // step's shorter room must still report its natural content height here,
    // or that cap would lock in and never relax for a step with more room.
    setPlace(placeDialog(rect, dialog.current?.scrollHeight ?? 150));
    if (!opened.current) {
      opened.current = true;
      next.current?.focus();
    }
  }, [rect]);

  // Closes any popover the tour opened and hands focus back to whatever opened
  // the tour, so the page is left as it was found.
  useEffect(() => {
    const opener = document.activeElement;
    return () => {
      if (held.current !== null && popoverOpen(held.current)) {
        clickTrigger(held.current);
      }
      held.current = null;
      if (opener instanceof HTMLElement) {
        opener.focus();
      }
    };
  }, []);

  // A React handler's stopPropagation would not reach the popover's own native
  // document listener, so this native one keeps a Next click from reading as a
  // click-away that closes the popover the tour is holding open.
  const shell = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = shell.current;
    const swallow = (event: PointerEvent) => event.stopPropagation();
    node?.addEventListener("pointerdown", swallow);
    return () => node?.removeEventListener("pointerdown", swallow);
  }, []);

  // The overlay takes no pointer events, so the click also reaches the control.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && shell.current?.contains(target) === true) {
        return;
      }
      // The popover a step opened stays open: the control being clicked lives
      // inside it, and closing it between press and release loses the click.
      held.current = null;
      onClose();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [onClose]);

  const advance = useCallback(() => {
    if (index + 1 >= live.length) {
      onClose();
      return;
    }
    setIndex(index + 1);
  }, [index, live.length, onClose]);
  advanceRef.current = advance;

  const back = useCallback(
    () => setIndex((current) => Math.max(0, current - 1)),
    [],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Space belongs to the transport.
      if (event.code === "Space") {
        onClose();
        return;
      }
      // Escape ends the tour from anywhere. The rest are the dialog's own keys,
      // and a page this no longer covers keeps them when focus has moved on.
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      const target = event.target;
      if (
        !(target instanceof Node) ||
        dialog.current?.contains(target) !== true
      ) {
        return;
      }
      event.stopPropagation();
      if (event.key === "ArrowRight" || event.key === "Enter") {
        event.preventDefault();
        advance();
      } else if (event.key === "ArrowLeft") {
        back();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [advance, back, onClose]);

  if (step === null || rect === null) {
    return null;
  }

  // Rendered from an estimate on the first paint, then corrected before the
  // next by the layout effect once the dialog can be measured.
  const shown = place ?? placeDialog(rect, 150);
  const last = index + 1 >= live.length;

  return (
    <div ref={shell} className="pointer-events-none fixed inset-0 z-[70]">
      <div
        aria-hidden="true"
        style={{
          top: rect.top - pad,
          left: rect.left - pad,
          width: rect.width + pad * 2,
          height: rect.height + pad * 2,
        }}
        className="pointer-events-none absolute rounded-xl shadow-[0_0_0_100vmax_color-mix(in_srgb,var(--void)_82%,transparent)] outline outline-2 outline-accent transition-all duration-200"
      />
      <div
        ref={dialog}
        role="dialog"
        aria-labelledby="walkthrough-title"
        style={{
          top: shown.top,
          left: shown.left,
          width: shown.width,
          maxHeight: shown.height,
        }}
        className="rise pointer-events-auto absolute overflow-y-auto rounded-xl border border-line-strong bg-panel p-4 shadow-[0_20px_60px_-12px_rgba(0,0,0,0.9)]"
      >
        <h2 id="walkthrough-title" className="label text-accent">
          {step.title}
        </h2>
        <p className="mt-1.5 text-muted text-sm leading-relaxed">{step.body}</p>
        <div className="mt-3 flex items-center gap-3">
          <span className="shrink-0 whitespace-nowrap font-mono text-faint text-xs tabular-nums">
            {index + 1} / {live.length}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Skip tutorial"
            className="mr-auto shrink-0 whitespace-nowrap font-mono text-faint text-xs transition-colors hover:text-muted"
          >
            Skip
          </button>
          {index === 0 ? null : (
            <button
              type="button"
              onClick={back}
              className="shrink-0 whitespace-nowrap rounded-lg border border-line-strong px-2.5 py-1 text-muted text-xs transition-colors hover:border-accent hover:text-accent"
            >
              Back
            </button>
          )}
          <button
            ref={next}
            type="button"
            onClick={advance}
            className="shrink-0 whitespace-nowrap rounded-lg bg-accent px-3 py-1 font-medium text-void text-xs transition-colors hover:bg-accent-glow"
          >
            {last ? "Done" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
