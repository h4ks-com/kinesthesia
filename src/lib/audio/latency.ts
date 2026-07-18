export const latencyRange = { min: -100, max: 200 } as const;

export function clampLatency(milliseconds: number): number {
  return Math.min(
    latencyRange.max,
    Math.max(latencyRange.min, Math.round(milliseconds)),
  );
}

/** A key pressed at `at` is judged against where the song was when the player
 * heard it, so both the output buffer and any manual offset are removed before
 * the hit window is applied. */
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
