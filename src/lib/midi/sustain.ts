/** A stretch of time with the pedal down, from the press to the lift. */
export type SustainSpan = {
  readonly start: number;
  readonly end: number;
};

export type PedalEvent = {
  readonly time: number;
  readonly value: number;
};

/** Control 64 reads as down from half travel up, the same threshold a hardware
 * pedal reports. */
const pedalDown = 0.5;

export function pedalSpans(
  events: readonly PedalEvent[],
  until: number,
): SustainSpan[] {
  const ordered = [...events].sort((left, right) => left.time - right.time);
  const spans: SustainSpan[] = [];
  let openedAt: number | null = null;
  for (const event of ordered) {
    const down = event.value >= pedalDown;
    if (down && openedAt === null) {
      openedAt = event.time;
    } else if (!down && openedAt !== null) {
      spans.push({ start: openedAt, end: event.time });
      openedAt = null;
    }
  }
  // A file that ends with the pedal still down holds to the last note.
  if (openedAt !== null && until > openedAt) {
    spans.push({ start: openedAt, end: until });
  }
  return spans;
}

/** When a note stops sounding: its own end, or the pedal lift that outlasts it. */
export function releaseAt(end: number, spans: readonly SustainSpan[]): number {
  for (const span of spans) {
    if (span.start > end) {
      break;
    }
    if (span.end > end) {
      return span.end;
    }
  }
  return end;
}
