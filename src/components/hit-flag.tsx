import { useEffect, useState } from "react";
import type { Hit, Verdict } from "@/lib/scoring/use-gates";

const label: Record<Verdict, string> = {
  perfect: "Perfect",
  good: "Good",
  miss: "Miss",
  letGo: "Let go",
};

const tone: Record<Verdict, string> = {
  perfect: "border-good/40 bg-good/15 text-good",
  good: "border-warn/40 bg-warn/15 text-warn",
  miss: "border-danger/40 bg-danger/15 text-danger",
  letGo: "border-warn/40 bg-warn/15 text-warn",
};

const linger = 800;

/** Sits just over the keys, where the eyes already are as a note lands. A timer
 * clears it rather than a fade, so it still shows and hides for someone who
 * asked for reduced motion, where every animation is nulled. The `seq` key
 * restarts the pop even when the verdict repeats. */
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
      className={`pop pointer-events-none absolute bottom-36 left-1/2 -translate-x-1/2 rounded-full border px-4 py-1 font-semibold text-sm backdrop-blur ${tone[shown.judgement]}`}
    >
      {label[shown.judgement]}
    </span>
  );
}
