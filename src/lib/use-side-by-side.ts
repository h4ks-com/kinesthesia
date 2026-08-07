"use client";

import { useEffect, useState } from "react";

/** The width the rolls stop stacking at and sit beside each other, which is
 * Tailwind's `lg` and the breakpoint the player's own layout turns on. */
const sideBySideFrom = "(min-width: 1024px)";

/** Whether the two rolls are laid out beside each other rather than stacked, so
 * anything drawn on the line between them knows which way that line runs.
 * False until mounted, since the server has no width to answer from. */
export function useSideBySide(): boolean {
  const [beside, setBeside] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(sideBySideFrom);
    setBeside(query.matches);
    const onChange = (event: MediaQueryListEvent): void =>
      setBeside(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return beside;
}
