import { useEffect, useState } from "react";
import { railInset } from "@/components/timing-rail";
import type { Hit, Verdict } from "@/lib/scoring/use-gates";

const label: Record<Verdict, string> = {
  perfect: "Perfect",
  good: "Good",
  miss: "Miss",
  letGo: "Held short",
};

const tone: Record<Verdict, string> = {
  perfect: "border-good/40 bg-good/15 text-good",
  good: "border-warn/40 bg-warn/15 text-warn",
  miss: "border-danger/40 bg-danger/15 text-danger",
  letGo: "border-warn/40 bg-warn/15 text-warn",
};

const linger = 800;

/** Sits against the middle of the timing rail, so the verdict and the mark it
 * put there read as one thing. A timer clears it rather than a fade, so it
 * still shows and hides for someone who asked for reduced motion, where every
 * animation is nulled. The `seq` key restarts the pop even when the verdict
 * repeats. */
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
    // Given the rail's own stretch and centred in it, so the two stay level
    // wherever the rail is asked to sit.
    <span
      aria-hidden="true"
      style={railInset}
      className="pointer-events-none absolute right-7 z-10 flex items-center"
    >
      <span
        key={shown.seq}
        className={`pop whitespace-nowrap rounded-full border px-3 py-1 font-semibold text-sm backdrop-blur ${tone[shown.judgement]}`}
      >
        {label[shown.judgement]}
      </span>
    </span>
  );
}
