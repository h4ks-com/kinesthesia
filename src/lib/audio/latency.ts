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

/** Above this, the delay is almost certainly the output device rather than the
 * browser: wireless headphones and speakers buffer far more than wired ones. */
export const suspiciousLatencyMs = 80;

export function latencyAdvice(totalSeconds: number): string | null {
  const milliseconds = Math.round(totalSeconds * 1000);
  if (milliseconds < suspiciousLatencyMs) {
    return null;
  }
  return `${milliseconds}ms is high. Wireless audio is the usual cause, so try wired output.`;
}
