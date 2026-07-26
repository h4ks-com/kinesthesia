"use client";

import { useEffect, useState } from "react";

const query = "(prefers-reduced-motion: reduce)";

/** Whether the player has asked their system for less movement. A full-screen
 * background is exactly what that setting is for, and a link can turn one on
 * without ever being saved, so the answer has to be live rather than read
 * once. */
export function useReducedMotion(): boolean {
  const [still, setStill] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(query);
    setStill(media.matches);
    const onChange = (event: MediaQueryListEvent) => setStill(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return still;
}
