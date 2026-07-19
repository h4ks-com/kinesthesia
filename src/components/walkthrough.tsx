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

const pad = 8;
const dialogWidth = 300;
const gap = 14;

type Placement = {
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

/** Sits the dialog below the spotlight, or above when the bottom is tight, and
 * keeps it on screen either way. On a phone it is pinned to the bottom. */
function placeDialog(rect: DOMRect, dialogHeight: number): Placement {
  const phone = window.innerWidth < 640;
  if (phone) {
    // Sit opposite the anchor's half so the dialog never covers the control it
    // is pointing at. The header lives up top, the transport and keys below.
    const anchorLow = rect.top + rect.height / 2 > window.innerHeight / 2;
    return {
      top: anchorLow ? gap : window.innerHeight - dialogHeight - gap,
      left: gap,
      width: window.innerWidth - gap * 2,
      height: dialogHeight,
    };
  }
  const below = rect.bottom + gap;
  const above = rect.top - gap - dialogHeight;
  const roomBelow = below + dialogHeight < window.innerHeight;
  const top = Math.min(
    Math.max(gap, roomBelow ? below : above),
    window.innerHeight - dialogHeight - gap,
  );
  const centred = rect.left + rect.width / 2 - dialogWidth / 2;
  const left = Math.min(
    Math.max(gap, centred),
    window.innerWidth - dialogWidth - gap,
  );
  return { top, left, width: dialogWidth, height: dialogHeight };
}

export function Walkthrough({ steps, onClose }: WalkthroughProps) {
  const [live, setLive] = useState<readonly TourStep[]>([]);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [place, setPlace] = useState<Placement | null>(null);
  const dialog = useRef<HTMLDivElement | null>(null);
  const next = useRef<HTMLButtonElement | null>(null);
  const held = useRef<string | null>(null);
  const advanceRef = useRef<() => void>(() => {});

  useLayoutEffect(() => {
    // A step whose anchor lives inside a popover counts as present when its
    // trigger is on the page, since the tour opens it to reveal the anchor.
    const present = steps.filter(
      (step) =>
        shownAnchor(step.anchor) !== null ||
        (step.open !== undefined && shownAnchor(step.open) !== null),
    );
    if (present.length === 0) {
      onClose();
      return;
    }
    setLive(present);
    setIndex(0);
  }, [steps, onClose]);

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
    // Opening a popover lands the anchor a render later, so the rect is chased
    // across a few frames before the step is given up as empty.
    let frame = 0;
    let tries = 0;
    const measure = () => {
      const el = shownAnchor(step.anchor);
      if (el !== null) {
        setRect(el.getBoundingClientRect());
      } else if (tries++ < 20) {
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
    setPlace(placeDialog(rect, dialog.current?.offsetHeight ?? 150));
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
      // The tour is modal, so keys are its own. Held in the capture phase and
      // stopped there, the player's window shortcuts (space to play, arrows to
      // shift the octave) stay quiet behind the overlay.
      event.stopPropagation();
      if (event.key === "Escape") {
        onClose();
      } else if (event.key === "ArrowRight" || event.key === "Enter") {
        event.preventDefault();
        advance();
      } else if (event.key === "ArrowLeft") {
        back();
      } else if (event.key === "Tab") {
        // aria-modal promises the app behind is inert, so Tab has to cycle
        // inside the dialog rather than reach the darkened controls.
        const focusable = dialog.current?.querySelectorAll("button");
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
    <div ref={shell} className="fixed inset-0 z-[70]">
      {/* Swallows clicks on the app: the tour is read by clicking through it. */}
      <button
        type="button"
        aria-label="Skip the tutorial"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />
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
        aria-modal="true"
        aria-labelledby="walkthrough-title"
        style={{ top: shown.top, left: shown.left, width: shown.width }}
        className="rise absolute rounded-xl border border-line-strong bg-panel p-4 shadow-[0_20px_60px_-12px_rgba(0,0,0,0.9)]"
      >
        <h2 id="walkthrough-title" className="label text-accent">
          {step.title}
        </h2>
        <p className="mt-1.5 text-muted text-sm leading-relaxed">{step.body}</p>
        <div className="mt-3 flex items-center gap-3">
          <span className="font-mono text-faint text-xs tabular-nums">
            {index + 1} / {live.length}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="mr-auto font-mono text-faint text-xs transition-colors hover:text-muted"
          >
            Skip tutorial
          </button>
          {index === 0 ? null : (
            <button
              type="button"
              onClick={back}
              className="rounded-lg border border-line-strong px-2.5 py-1 text-muted text-xs transition-colors hover:border-accent hover:text-accent"
            >
              Back
            </button>
          )}
          <button
            ref={next}
            type="button"
            onClick={advance}
            className="rounded-lg bg-accent px-3 py-1 font-medium text-void text-xs transition-colors hover:bg-accent-glow"
          >
            {last ? "Done" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
