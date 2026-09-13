/**
 * A SysEx control's shape: the body between F0 and F7, with null where the
 * message varies. We read makers' messages the way they close them, with the
 * position first among the varying bytes and anything after it (a checksum)
 * ignored. A device that sends a fine byte ahead of a moving coarse one reads by
 * its fine byte. A pattern with nothing varying is a button that sends one fixed
 * message.
 */
export type SysexPattern = readonly (number | null)[];

/** The SysEx controls the page listens for. */
export type SysexListening = {
  readonly patterns: readonly SysexPattern[];
  /** A control is being bound, so an unbound slider is searched for as well. */
  readonly learning: boolean;
};

export function matchesPattern(
  body: readonly number[],
  pattern: SysexPattern,
): boolean {
  return body.length === pattern.length && startsPattern(body, pattern);
}

export function startsPattern(
  bytes: readonly number[],
  pattern: SysexPattern,
): boolean {
  return (
    bytes.length <= pattern.length &&
    bytes.every((byte, index) => {
      const expected = pattern[index];
      return expected === null || expected === byte;
    })
  );
}

/** Whether one message could match both, so binding both would fight over it. */
export function patternsOverlap(a: SysexPattern, b: SysexPattern): boolean {
  return (
    a.length === b.length &&
    a.every((byte, index) => {
      const other = b[index];
      return byte === null || other === null || byte === other;
    })
  );
}

/** The position a matching message reports, or null for a fixed message. */
export function patternValue(
  body: readonly number[],
  pattern: SysexPattern,
): number | null {
  const slot = pattern.indexOf(null);
  return slot === -1 ? null : (body[slot] ?? null);
}

/** How many leading bytes spell out the control before its position. A fixed
 * message counts all but its last byte, so it is known before it ends too. */
export function patternHeadLength(pattern: SysexPattern): number {
  const slot = pattern.indexOf(null);
  return slot === -1 ? pattern.length - 1 : slot;
}

export function patternHead(pattern: SysexPattern): number[] {
  return pattern
    .slice(0, patternHeadLength(pattern))
    .filter((byte): byte is number => byte !== null);
}

export function samePattern(a: SysexPattern, b: SysexPattern): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

/**
 * The shape shared by messages one control sent while it moved: bytes that held
 * still name it, and the bytes that changed close the message and carry its
 * position. Null until the samples differ, or when what changed cannot be one
 * control's position.
 */
export function learnPattern(
  samples: readonly (readonly number[])[],
): SysexPattern | null {
  const [first, ...others] = samples;
  if (
    first === undefined ||
    others.some((sample) => sample.length !== first.length)
  ) {
    return null;
  }
  const pattern = first.map((byte, index) =>
    others.every((sample) => sample[index] === byte) ? byte : null,
  );
  const firstVarying = pattern.indexOf(null);
  const varying = pattern.length - firstVarying;
  const hasTrailingVariation =
    firstVarying !== -1 &&
    pattern.slice(firstVarying).every((byte) => byte === null);
  return hasTrailingVariation && pattern.length - varying >= 2 * varying
    ? pattern
    : null;
}
