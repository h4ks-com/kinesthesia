import { type RefObject, useEffect, useState } from "react";

/** How far ahead of the fold something counts as near. Enough that scrolling
 * finds it already running rather than starting. */
const reach = "300px";

/** Whether an element has come near enough to be looked at, and true from then
 * on. For work worth putting off until somebody scrolls to it: every background
 * preview is a worker holding a WebGL context, and a browser keeps only so many
 * of those before it starts dropping the oldest. */
export function useNearby(what: RefObject<Element | null>): boolean {
  const [near, setNear] = useState(false);

  useEffect(() => {
    const node = what.current;
    if (node === null) {
      return;
    }
    const watch = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          watch.disconnect();
        }
      },
      { rootMargin: reach },
    );
    watch.observe(node);
    return () => watch.disconnect();
  }, [what]);

  return near;
}
