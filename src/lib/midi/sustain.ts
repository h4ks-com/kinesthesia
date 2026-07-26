export type SustainSpan = {
  readonly start: number;
  readonly end: number;
};

export type PedalEvent = {
  readonly time: number;
  readonly value: number;
};

/** Half travel, the same threshold a hardware pedal reports. */
const pedalDown = 0.5;
/** A string is silent well before this, and a pedal is often written pressed
 * and never lifted. Without a bound such a note holds a voice and its key for
 * the rest of the file, and the roll's scan window widens to the whole song. */
const maxCarrySeconds = 6;

export function pedalSpans(
  events: readonly PedalEvent[],
  lastNoteEnd: number,
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
  if (openedAt !== null && lastNoteEnd > openedAt) {
    spans.push({ start: openedAt, end: lastNoteEnd });
  }
  return spans;
}

export function releaseAt(end: number, spans: readonly SustainSpan[]): number {
  for (const span of spans) {
    if (span.start > end) {
      break;
    }
    if (span.end > end) {
      return Math.min(span.end, end + maxCarrySeconds);
    }
  }
  return end;
}
