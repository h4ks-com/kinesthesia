import { useEffect, useState } from "react";
import type { Judgement } from "@/lib/scoring/judge";
import type { Hit } from "@/lib/scoring/use-gates";

const label: Record<Judgement, string> = {
  perfect: "Perfect",
  good: "Good",
  miss: "Miss",
};

const tone: Record<Judgement, string> = {
  perfect: "border-warn/40 bg-warn/15 text-warn",
  good: "border-good/40 bg-good/15 text-good",
  miss: "border-danger/40 bg-danger/15 text-danger",
};

const linger = 800;

/** A timer clears the flag rather than a fade, so it still shows and hides for
 * someone who asked for reduced motion, where every animation is nulled. The
 * `seq` key restarts the pop even when the verdict repeats. */
export function HitFlag({ hit }: { hit: Hit | null }) {
  const [shown, setShown] = useState<Hit | null>(null);

  useEffect(() => {
    if (hit === null) {
      return;
    }
    setShown(hit);
    const timer = setTimeout(() => setShown(null), linger);
    return () => clearTimeout(timer);
  }, [hit]);

  if (shown === null) {
    return null;
  }
  return (
    <span
      key={shown.seq}
      aria-hidden="true"
      className={`pop pointer-events-none absolute top-20 left-1/2 -translate-x-1/2 rounded-full border px-4 py-1 font-semibold text-sm backdrop-blur ${tone[shown.judgement]}`}
    >
      {label[shown.judgement]}
    </span>
  );
}
