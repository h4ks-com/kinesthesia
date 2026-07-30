export const latencyRange = { min: -100, max: 200 } as const;

export function clampLatency(milliseconds: number): number {
  return Math.min(
    latencyRange.max,
    Math.max(latencyRange.min, Math.round(milliseconds)),
  );
}

/** A key pressed at `at` is judged against where the song was when the player
 * heard it, so the graph's latency and the manual offset are removed before the
 * hit window is applied. The device buffer is the offset's job. */
export function judgedPosition(
  position: number,
  pressedAt: number,
  now: number,
  outputLatency: number,
  offsetMilliseconds: number,
): number {
  const sincePress = Math.max(0, (now - pressedAt) / 1000);
  return Math.max(
    0,
    position - sincePress - outputLatency - offsetMilliseconds / 1000,
  );
}

/** Hits to see before the drift in them means anything, and the drift worth
 * mentioning. Below this a player is just human. */
const timedHits = 12;
const noticeableDriftMs = 30;

/** Where the offset should sit, read from how late or early a player's own hits
 * keep landing. The device's delay cannot be asked for, so the playing is the
 * only evidence there is. Null while the hits say nothing. */
export function suggestedOffset(
  deltas: readonly number[],
  current: number,
): number | null {
  if (deltas.length < timedHits) {
    return null;
  }
  const sorted = [...deltas].sort((left, right) => left - right);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const drift = Math.round(median * 1000);
  if (Math.abs(drift) < noticeableDriftMs) {
    return null;
  }
  const next = clampLatency(current + drift);
  return next === current ? null : next;
}
