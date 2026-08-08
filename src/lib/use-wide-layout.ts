"use client";

import { useEffect, useState } from "react";

/** Tailwind's `lg`, which is the width the player's own layout lays its halves
 * out side by side at. Named here because nothing in JS can read it back off
 * the config. */
const wideFrom = "(min-width: 1024px)";

/** Whether the view is wide enough for the player's halves to sit beside each
 * other, so anything drawn along the edge between them knows which way that
 * edge runs. False until mounted, since the server has no width to answer
 * from. */
export function useWideLayout(): boolean {
  const [wide, setWide] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(wideFrom);
    setWide(query.matches);
    const onChange = (event: MediaQueryListEvent): void =>
      setWide(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return wide;
}
