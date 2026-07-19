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

/** The `seq` key restarts the pop animation even when the verdict repeats. */
export function HitFlag({ hit }: { hit: Hit | null }) {
  if (hit === null) {
    return null;
  }
  return (
    <span
      key={hit.seq}
      aria-hidden="true"
      className={`pop pointer-events-none absolute top-20 left-1/2 -translate-x-1/2 rounded-full border px-4 py-1 font-semibold text-sm backdrop-blur ${tone[hit.judgement]}`}
    >
      {label[hit.judgement]}
    </span>
  );
}
