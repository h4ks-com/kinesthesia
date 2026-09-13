/** Both halves of a match show their tally the same way, so neither side reads
 * as the more important one. The share is of the whole part rather than of the
 * notes reached, so it climbs as the song is got through: how near the beat
 * they landed is the rail's business and the card's. */
export function ScoreReadout({
  points,
  got,
  combo,
}: {
  points: number;
  got: number;
  combo: number;
}) {
  return (
    <span className="flex shrink-0 items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 font-mono text-xs">
      <span className="text-accent">{points}</span>
      <span className="text-faint">
        {Math.round(got * 100)}% · {combo}x
      </span>
    </span>
  );
}
