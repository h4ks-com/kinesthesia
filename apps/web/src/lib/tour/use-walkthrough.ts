"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const prefix = "kinesthesia:tour:";

function hasSeen(tour: string): boolean {
  try {
    return localStorage.getItem(`${prefix}${tour}`) === "1";
  } catch {
    // No storage means no memory of a first visit, so the tour holds back to
    // avoid running on every load.
    return true;
  }
}

function markSeen(tour: string): void {
  try {
    localStorage.setItem(`${prefix}${tour}`, "1");
  } catch {}
}

export type Walkthrough = {
  readonly open: boolean;
  /** Runs the tour on demand, whether or not it has been seen. */
  readonly start: () => void;
  /** Ends the tour and remembers it, so finishing and skipping both count. */
  readonly close: () => void;
};

/** Auto-runs a mode's tour on a first eligible visit, and hands back a `start`
 * for the help button to replay it. `eligible` folds in both who may see it
 * (a match host, not a joiner) and whether the page is ready to point at. */
export function useWalkthrough(tour: string, eligible: boolean): Walkthrough {
  const [open, setOpen] = useState(false);
  const autoDone = useRef(false);

  useEffect(() => {
    if (!eligible || autoDone.current) {
      return;
    }
    autoDone.current = true;
    if (!hasSeen(tour)) {
      setOpen(true);
    }
  }, [eligible, tour]);

  const start = useCallback(() => setOpen(true), []);
  const close = useCallback(() => {
    setOpen(false);
    markSeen(tour);
  }, [tour]);

  return { open, start, close };
}
