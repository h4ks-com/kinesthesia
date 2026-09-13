import { describe, expect, it } from "vitest";
import {
  createSysexRecovery,
  frameSplitSysex,
  type TimedMessage,
} from "@/lib/input/chrome-split-sysex";
import {
  genosSlider,
  notesOf,
  rolandDataSet,
  rolandSlider,
  sysexBodiesOf,
} from "@/lib/input/sysex-fixtures";
import type { SysexListening, SysexPattern } from "@/lib/input/sysex-pattern";
import { decodeMidi, type MidiEvent } from "@/lib/input/web-midi";

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

/** A Genos2 slider sweep as Chrome on macOS delivered it to the page: the keys
 * played before it, then each parameter change with its F0 and F7 gone, chopped
 * into note-ons under the status of the last key, with active sensing between. */
const chromeSweep: readonly (readonly number[])[] = [
  [617241, 144, 42, 73],
  [617361, 144, 42, 0],
  [617395, 144, 42, 68],
  [617502, 254],
  [617511, 144, 42, 0],
  [618024, 144, 39, 59],
  [618128, 144, 39, 0],
  [619318, 144, 67, 16],
  [619318, 144, 76, 16],
  [619319, 144, 0, 11],
  [619332, 144, 120, 67],
  [619332, 144, 16, 76],
  [619332, 144, 16, 0],
  [619333, 144, 11, 118],
  [619346, 144, 67, 16],
  [619346, 144, 76, 16],
  [619347, 144, 0, 11],
  [619360, 144, 116, 67],
  [619360, 144, 16, 76],
  [619360, 144, 16, 0],
  [619361, 144, 11, 111],
  [619374, 144, 67, 16],
  [619374, 144, 76, 16],
  [619375, 144, 0, 11],
  [619503, 254],
  [619702, 254],
  [619902, 254],
  [620405, 144, 105, 67],
  [620405, 144, 16, 76],
  [620405, 144, 16, 0],
  [620406, 144, 11, 1],
  [620420, 144, 67, 16],
  [620420, 144, 76, 16],
  [620421, 144, 0, 11],
];

function genosBody(value: number): number[] {
  return [0x43, 0x10, 0x4c, 0x10, 0x00, 0x0b, value];
}

/** SysEx bodies the way the browser splits them: laid end to end in pairs under
 * the last status, one message a millisecond, the odd byte left held. */
function chromeSplit(
  bodies: readonly (readonly number[])[],
  start: number,
  status = 0x90,
): number[][] {
  const flat = bodies.flat();
  return Array.from({ length: Math.floor(flat.length / 2) }, (_, index) => [
    start + index,
    status,
    flat[index * 2] ?? 0,
    flat[index * 2 + 1] ?? 0,
  ]);
}

function bound(...patterns: SysexPattern[]): SysexListening {
  return { patterns, learning: false };
}

const learning: SysexListening = { patterns: [], learning: true };

function replay(
  log: readonly (readonly number[])[],
  listening: SysexListening,
): MidiEvent[] {
  const recovery = createSysexRecovery();
  const events: MidiEvent[] = [];
  const deliver = (messages: readonly TimedMessage[]): void => {
    for (const { message, at } of messages) {
      const decoded = decodeMidi(message, at);
      if (decoded !== null) {
        events.push(decoded);
      }
    }
  };
  for (const [at = 0, ...data] of log) {
    deliver(recovery.expire(at));
    deliver(recovery.push(Uint8Array.from(data), at, at, listening));
  }
  deliver(recovery.expire(Number.POSITIVE_INFINITY));
  return events;
}

describe("a bound SysEx control the browser split into channel messages", () => {
  it("moves a bound Genos2 slider and plays no note of it", () => {
    const events = replay(chromeSweep, bound(genosSlider));
    expect(notesOf(events)).toEqual(["42+", "42-", "42+", "42-", "39+", "39-"]);
    expect(sysexBodiesOf(events).map((body) => body[6])).toEqual([
      120, 118, 116, 111, 105, 1,
    ]);
  });

  it("moves a bound Roland slider, checksum and all", () => {
    const sweep = [20, 21, 22, 23].map(rolandDataSet);
    const events = replay(
      [[0, 0x90, 60, 90], [5, 0x90, 60, 0], ...chromeSplit(sweep, 100)],
      bound(rolandSlider),
    );
    expect(notesOf(events)).toEqual(["60+", "60-"]);
    expect(sysexBodiesOf(events)).toEqual(sweep);
  });

  it("recovers a bound button's release along with its press", () => {
    const press = [0x42, 0x30, 0x00, 0x01, 0x2c, 0x7f];
    const release = [0x42, 0x30, 0x00, 0x01, 0x2c, 0x00];
    const events = replay(chromeSplit([press, release], 0), bound(press));
    expect(notesOf(events)).toEqual([]);
    expect(sysexBodiesOf(events)).toEqual([press, release]);
  });

  it("keeps a slider bound as a button at one position from playing notes", () => {
    const sweep = [120, 118, 116, 114].map(genosBody);
    const events = replay(chromeSplit(sweep, 0), bound(genosBody(120)));
    expect(notesOf(events)).toEqual([]);
  });

  it("leaves every message alone when no SysEx control is listened for", () => {
    const events = replay(
      [
        [0, 144, 67, 16],
        [1, 144, 76, 16],
        [2, 144, 0, 11],
      ],
      bound(),
    );
    expect(notesOf(events)).toEqual(["67+", "76+", "0+"]);
  });

  // A bound address split into pairs asks for pitch 0, which no keyboard
  // sends, so a chord that opens the same way is let through intact.
  it("plays a soft chord that opens like a bound slider, in order", () => {
    const events = replay(
      [
        [0, 144, 67, 16],
        [1, 144, 76, 16],
        [2, 144, 72, 16],
      ],
      bound(genosSlider),
    );
    expect(notesOf(events)).toEqual(["67+", "76+", "72+"]);
  });

  it("sounds a lone note that could open a bound slider once its wait is out", () => {
    const recovery = createSysexRecovery();
    expect(
      recovery.push(bytes(0x90, 0x43, 0x10), 100, 100, bound(genosSlider)),
    ).toEqual([]);
    expect(recovery.expire(159)).toEqual([]);
    expect(recovery.expire(160)).toEqual([
      { message: bytes(0x90, 0x43, 0x10), at: 100 },
    ]);
  });

  // The browser holds the last byte of a paused sweep until the slider moves
  // again, and a key struck first drops it, so that key is played as struck.
  it("plays the first key struck after a paused sweep", () => {
    const events = replay(
      [
        [0, 144, 67, 16],
        [0, 144, 76, 16],
        [1, 144, 0, 11],
        [900, 144, 60, 67],
        [1100, 144, 60, 0],
      ],
      bound(genosSlider),
    );
    expect(notesOf(events)).toEqual(["60+", "60-"]);
    expect(sysexBodiesOf(events)).toHaveLength(0);
  });

  it("plays that key the moment the next message shows it was real", () => {
    const recovery = createSysexRecovery();
    const listening = bound(genosSlider);
    for (const [at, ...data] of [
      [0, 144, 67, 16],
      [0, 144, 76, 16],
      [1, 144, 0, 11],
    ]) {
      recovery.push(Uint8Array.from(data), at ?? 0, at ?? 0, listening);
    }
    expect(recovery.push(bytes(0x90, 60, 67), 900, 900, listening)).toEqual([]);
    const released = recovery.push(bytes(0x90, 60, 0), 910, 910, listening);
    expect(released.map(({ message }) => Array.from(message))).toEqual([
      [0x90, 60, 67],
      [0x90, 60, 0],
    ]);
  });
});

describe("binding a slider the browser splits", () => {
  it("finds a Genos2 slider nothing is bound to yet", () => {
    const events = replay(chromeSweep, learning);
    expect(notesOf(events)).toEqual(["42+", "42-", "42+", "42-", "39+", "39-"]);
    expect(sysexBodiesOf(events)).toHaveLength(6);
  });

  it("finds a Roland slider from its bytes alone", () => {
    const sweep = [30, 32, 34, 36, 38].map(rolandDataSet);
    const events = replay(chromeSplit(sweep, 0, 0xb0), learning);
    expect(notesOf(events)).toEqual([]);
    expect(events.filter((event) => event.type === "control")).toEqual([]);
    expect(sysexBodiesOf(events)).toEqual(sweep.slice(0, 4));
  });

  it("releases a key let go just before the slider moved", () => {
    const sweep = [100, 98, 96, 94].map(genosBody);
    const events = replay(
      [[0, 0x90, 60, 90], [400, 0x90, 60, 0], ...chromeSplit(sweep, 410)],
      learning,
    );
    expect(notesOf(events)).toEqual(["60+", "60-"]);
    expect(sysexBodiesOf(events).map((body) => body[6])).toEqual([
      100, 98, 96, 94,
    ]);
  });

  it("hands on a controller sweep in order", () => {
    const log = [10, 20, 30, 40, 50, 60].map((value, index) => [
      index * 10,
      0xb0,
      7,
      value,
    ]);
    const events = replay(log, learning);
    expect(
      events.flatMap((event) =>
        event.type === "control" ? [event.value] : [],
      ),
    ).toEqual([10, 20, 30, 40, 50, 60]);
  });

  it("hands on a trill in order", () => {
    const log = [60, 62, 60, 62, 60, 62].flatMap((pitch, index) => [
      [index * 20, 0x90, pitch, 70 + index],
      [index * 20 + 10, 0x90, pitch, 0],
    ]);
    expect(notesOf(replay(log, learning))).toEqual(
      [60, 62, 60, 62, 60, 62].flatMap((pitch) => [`${pitch}+`, `${pitch}-`]),
    );
  });

  it("hands on a flood of bends as it goes, oldest first", () => {
    const recovery = createSysexRecovery();
    const handedOn = Array.from({ length: 200 }, (_, index) =>
      recovery.push(bytes(0xe0, index % 128, 64), index, index, learning),
    ).flat();
    expect(handedOn.length).toBeGreaterThan(150);
    expect(handedOn.map(({ at }) => at)).toEqual(
      [...handedOn.map(({ at }) => at)].sort((a, b) => a - b),
    );
  });
});

describe("framing a repeating run of bytes", () => {
  it("starts at the first whole message when the run opens partway through one", () => {
    const run = [23, 0x0b, ...[1, 2, 3].flatMap(genosBody), 0x43, 0x10];
    const framed = frameSplitSysex(run);
    expect(framed?.offset).toBe(2);
    expect(framed?.pattern).toEqual(genosSlider);
    expect(framed?.bodies.map((body) => body[6])).toEqual([1, 2, 3]);
    expect(framed?.rest).toEqual([0x43, 0x10]);
  });
});
