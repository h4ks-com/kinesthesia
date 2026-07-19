/** Both halves of a match show their tally the same way, so neither side reads
 * as the more important one. */
export function ScoreReadout({
  points,
  accuracy,
  combo,
}: {
  points: number;
  accuracy: number;
  combo: number;
}) {
  return (
    <span className="flex shrink-0 items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 font-mono text-xs">
      <span className="text-accent">{points}</span>
      <span className="text-faint">
        {Math.round(accuracy * 100)}% · {combo}x
      </span>
    </span>
  );
}
