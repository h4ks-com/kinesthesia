import {
  learnPattern,
  matchesPattern,
  patternHeadLength,
  type SysexListening,
  type SysexPattern,
  startsPattern,
} from "@/lib/input/sysex-pattern";

/**
 * Chrome on macOS hands the page a SysEx that arrived split across packets
 * without its F0 and F7, parsed as channel messages under whatever status came
 * last. Its bytes still arrive in order, one message laid after the next, but a
 * slider sending them plays notes nothing ever releases. We put SysEx controls
 * back together from those bytes and pass everything else on.
 *
 * We recover only a control the page listens for, so we take real playing for
 * one only when it repeats a bound control byte for byte. While a control is
 * being bound we also read a repeating run of bytes as one.
 *
 * No browser reports that it splits, so this runs in every browser. It costs a
 * short wait only for messages that spell out the start of a bound control, and
 * while a control is being bound.
 */

export type TimedMessage = {
  readonly message: Uint8Array;
  readonly at: number;
};

export type SysexRecovery = {
  /** What to act on now, with any control rebuilt from bytes the browser
   * handed over as channel messages. `now` is when the page handled it, which
   * is what a wait is measured from. */
  push: (
    message: Uint8Array,
    at: number,
    now: number,
    listening: SysexListening,
  ) => TimedMessage[];
  expire: (now: number) => TimedMessage[];
  /** When something held is due to be let go, or null when nothing is. */
  due: () => number | null;
};

type Held = TimedMessage & { readonly since: number };

type Run = {
  readonly bodies: readonly (readonly number[])[];
  readonly rest: readonly number[];
};

/** How long a message that could open a bound control waits for the next one to
 * settle it. A real note pays this, so it is short. Inside a control already
 * shown to be split only the browser's own packets arrive, and they can queue
 * behind a busy frame, so there it is long. While binding, a slider needs a few
 * of its messages before it repeats, and nobody is playing. */
const openingWaitMs = 60;
const midRunWaitMs = 300;
const searchWaitMs = 300;

/** Bounds on a searched for control. Shorter repeats are what a trill or a
 * controller sweep look like, makers' parameter messages fit well inside the
 * longest, and three messages show which bytes hold still. We search only the
 * newest bytes, so a flood of messages costs the same per message. */
const shortestBody = 5;
const longestBody = 16;
const bodiesToFrame = 3;
const searchWindow = longestBody * bodiesToFrame;

/** The shape we recover a bound control by. A button binds the one message it
 * sends, and its release differs only in the position and checksum its maker
 * closes the message with, so we recover both and let the binding tell them
 * apart. */
function recoveryShape(pattern: SysexPattern): SysexPattern {
  return pattern.includes(null)
    ? pattern
    : pattern.map((byte, index) => (index < pattern.length - 2 ? byte : null));
}

/** Bytes read as bound control messages laid end to end, or null where they stop
 * being one. */
function readRun(
  bytes: readonly number[],
  patterns: readonly SysexPattern[],
): Run | null {
  const bodies: number[][] = [];
  let at = 0;
  for (;;) {
    const pattern = patterns.find(
      (candidate) =>
        bytes.length - at >= candidate.length &&
        matchesPattern(bytes.slice(at, at + candidate.length), candidate),
    );
    if (pattern === undefined) {
      break;
    }
    bodies.push(bytes.slice(at, at + pattern.length));
    at += pattern.length;
  }
  const rest = bytes.slice(at);
  return rest.length > 0 &&
    !patterns.some((pattern) => startsPattern(rest, pattern))
    ? null
    : { bodies, rest };
}

/** A run of bytes read as one control repeating: where its first whole message
 * starts, the shape it repeats and the start of its next message. Null when the
 * bytes do not repeat like one. */
export function frameSplitSysex(
  bytes: readonly number[],
): (Run & { readonly offset: number; readonly pattern: SysexPattern }) | null {
  for (
    let length = shortestBody;
    length <= longestBody && length * bodiesToFrame <= bytes.length;
    length++
  ) {
    for (
      let offset = 0;
      offset < length && offset + length * bodiesToFrame <= bytes.length;
      offset++
    ) {
      const count = Math.floor((bytes.length - offset) / length);
      const bodies = Array.from({ length: count }, (_, index) =>
        bytes.slice(offset + index * length, offset + (index + 1) * length),
      );
      const pattern = learnPattern(bodies);
      if (pattern !== null) {
        const rest = bytes.slice(offset + count * length);
        return { offset, pattern, bodies, rest };
      }
    }
  }
  return null;
}

function sysexOf(body: readonly number[], at: number): TimedMessage {
  return { message: Uint8Array.from([0xf0, ...body, 0xf7]), at };
}

function dataOf(message: Uint8Array): number[] {
  return Array.from(message.subarray(1));
}

/** How many leading entries carry their data bytes wholly within the first
 * `limit` bytes. */
function entriesEndingBy(entries: readonly Held[], limit: number): number {
  let end = 0;
  let count = 0;
  for (const entry of entries) {
    end += entry.message.length - 1;
    if (end > limit) {
      break;
    }
    count++;
  }
  return count;
}

function releasedOf(entries: readonly Held[]): TimedMessage[] {
  return entries.map(({ message, at }) => ({ message, at }));
}

export function createSysexRecovery(): SysexRecovery {
  let provenControlBytes: number[] = [];
  let held: Held[] = [];
  let status: number | null = null;
  let patterns: readonly SysexPattern[] = [];
  let isSearching = false;
  let foundWhileBinding: SysexPattern | null = null;

  const isControlHead = (bytes: readonly number[]): boolean =>
    patterns.some(
      (pattern) =>
        startsPattern(bytes, pattern) &&
        bytes.length >= patternHeadLength(pattern),
    );

  const isMidRun = (): boolean =>
    provenControlBytes.length > 0 && !isControlHead(provenControlBytes);

  // Anything that breaks the run is a real message, and a real status byte is
  // what makes the browser drop the byte it was still holding. Held messages
  // continuing a control already under way were its bytes, so we drop them;
  // ones that only might have opened one were real playing, so we hand them on.
  const settle = (): TimedMessage[] => {
    const released = isMidRun() ? [] : releasedOf(held);
    provenControlBytes = [];
    held = [];
    status = null;
    return released;
  };

  const search = (
    message: Uint8Array,
    at: number,
    now: number,
  ): TimedMessage[] => {
    provenControlBytes = [];
    held = [...held, { message, at, since: now }];
    const heldBytes = held.flatMap((entry) => dataOf(entry.message));
    const tooOld = entriesEndingBy(held, heldBytes.length - searchWindow);
    const released = releasedOf(held.slice(0, tooOld));
    held = held.slice(tooOld);

    const framed = frameSplitSysex(
      held.flatMap((entry) => dataOf(entry.message)),
    );
    if (framed === null) {
      return released;
    }
    // Messages wholly ahead of the first framed message were real playing.
    const playedFirst = releasedOf(
      held.slice(0, entriesEndingBy(held, framed.offset)),
    );
    foundWhileBinding = framed.pattern;
    patterns = [...patterns, framed.pattern];
    isSearching = false;
    provenControlBytes = [...framed.rest];
    held = [];
    return [
      ...released,
      ...playedFirst,
      ...framed.bodies.map((body) => sysexOf(body, at)),
    ];
  };

  const push = (
    message: Uint8Array,
    at: number,
    now: number,
    listening: SysexListening,
  ): TimedMessage[] => {
    if (!listening.learning) {
      foundWhileBinding = null;
    }
    const bound = listening.patterns.map(recoveryShape);
    patterns =
      foundWhileBinding === null ? bound : [...bound, foundWhileBinding];
    isSearching = listening.learning && foundWhileBinding === null;

    const head = message[0];
    if (head === undefined || head >= 0xf8) {
      return [{ message, at }];
    }
    if (head >= 0xf0) {
      return [...settle(), { message, at }];
    }
    if (status !== null && head !== status) {
      return [...settle(), ...push(message, at, now, listening)];
    }
    if (isSearching) {
      status = head;
      return search(message, at, now);
    }
    const run = readRun(
      [
        ...provenControlBytes,
        ...held.flatMap((entry) => dataOf(entry.message)),
        ...dataOf(message),
      ],
      patterns,
    );
    if (run === null) {
      return status === null
        ? [{ message, at }]
        : [...settle(), ...push(message, at, now, listening)];
    }
    status = head;
    // A lone byte after a whole control is also how a key struck after a paused
    // sweep reads, so we wait for one more message to settle which it was.
    if (run.bodies.length > 0 && run.rest.length !== 1) {
      provenControlBytes = [...run.rest];
      held = [];
      return run.bodies.map((body) => sysexOf(body, at));
    }
    if (run.bodies.length === 0 && isControlHead(run.rest)) {
      provenControlBytes = [...run.rest];
      held = [];
      return [];
    }
    held = [...held, { message, at, since: now }];
    return [];
  };

  const due = (): number | null => {
    const first = held[0];
    if (first === undefined) {
      return null;
    }
    const wait = isSearching
      ? searchWaitMs
      : isMidRun()
        ? midRunWaitMs
        : openingWaitMs;
    return first.since + wait;
  };

  const expire = (now: number): TimedMessage[] => {
    const deadline = due();
    return deadline === null || now < deadline ? [] : settle();
  };

  return { push, expire, due };
}
