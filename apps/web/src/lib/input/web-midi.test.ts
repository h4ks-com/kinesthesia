import { describe, expect, it } from "vitest";
import {
  genosSlider,
  notesOf,
  sysexBodiesOf,
} from "@/lib/input/sysex-fixtures";
import type { SysexListening } from "@/lib/input/sysex-pattern";
import {
  connectMidiInputs,
  decodeMidi,
  type MidiEvent,
} from "@/lib/input/web-midi";

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

describe("decodeMidi", () => {
  it("reads a note on with its channel", () => {
    expect(decodeMidi(bytes(0x92, 60, 100), 5)).toEqual({
      type: "note",
      pitch: 60,
      velocity: 100 / 127,
      down: true,
      channel: 2,
      at: 5,
    });
  });

  it("treats a zero-velocity note on as a release", () => {
    expect(decodeMidi(bytes(0x90, 60, 0), 0)).toMatchObject({
      type: "note",
      down: false,
    });
  });

  it("reads a note off", () => {
    const event = decodeMidi(bytes(0x81, 64, 40), 0);
    expect(event).toMatchObject({ type: "note", down: false, channel: 1 });
  });

  it("reads a program change on its channel", () => {
    expect(decodeMidi(bytes(0xc3, 48), 0)).toEqual({
      type: "program",
      channel: 3,
      program: 48,
    });
  });

  it("reads the sustain pedal down and up on control 64", () => {
    expect(decodeMidi(bytes(0xb0, 64, 127), 0)).toEqual({
      type: "sustain",
      channel: 0,
      down: true,
    });
    expect(decodeMidi(bytes(0xb0, 64, 0), 0)).toEqual({
      type: "sustain",
      channel: 0,
      down: false,
    });
  });

  it("passes through a control change it does not model", () => {
    expect(decodeMidi(bytes(0xb0, 7, 100), 0)).toEqual({
      type: "control",
      channel: 0,
      controller: 7,
      value: 100,
    });
  });

  it("ignores messages it does not model", () => {
    expect(decodeMidi(bytes(0xd0, 64, 0), 0)).toBeNull();
  });
});

function bendOf(data: Uint8Array): number | null {
  const event = decodeMidi(data, 0);
  return event !== null && event.type === "bend" ? event.amount : null;
}

describe("expression events", () => {
  it("reads the bend wheel as a signed fraction, centred at rest", () => {
    expect(decodeMidi(bytes(0xe0, 0, 64), 0)).toEqual({
      type: "bend",
      channel: 0,
      amount: 0,
    });
    expect(bendOf(bytes(0xe0, 127, 127))).toBeCloseTo(1, 3);
    expect(bendOf(bytes(0xe0, 0, 0))).toBe(-1);
  });

  it("keeps the bend on the channel it arrived on", () => {
    expect(decodeMidi(bytes(0xe4, 0, 0), 0)).toEqual({
      type: "bend",
      channel: 4,
      amount: -1,
    });
  });

  it("reads the modulation wheel on control 1", () => {
    expect(decodeMidi(bytes(0xb0, 1, 127), 0)).toEqual({
      type: "modulation",
      channel: 0,
      depth: 1,
    });
    expect(decodeMidi(bytes(0xb0, 1, 0), 0)).toEqual({
      type: "modulation",
      channel: 0,
      depth: 0,
    });
  });

  it("keeps a control change on the channel it arrived on", () => {
    expect(decodeMidi(bytes(0xb5, 70, 10), 0)).toEqual({
      type: "control",
      channel: 5,
      controller: 70,
      value: 10,
    });
  });
});

describe("sysex", () => {
  it("reads any maker's message as the bytes between F0 and F7", () => {
    expect(
      decodeMidi(
        bytes(0xf0, 0x43, 0x10, 0x4c, 0x10, 0x00, 0x0b, 0x7f, 0xf7),
        0,
      ),
    ).toEqual({
      type: "sysex",
      body: [0x43, 0x10, 0x4c, 0x10, 0x00, 0x0b, 0x7f],
    });
    expect(
      decodeMidi(bytes(0xf0, 0x7f, 0x7f, 0x04, 0x01, 0, 99, 0xf7), 0),
    ).toEqual({ type: "sysex", body: [0x7f, 0x7f, 0x04, 0x01, 0, 99] });
  });

  it("ignores a message with no end or nothing in it", () => {
    expect(decodeMidi(bytes(0xf0, 0x43, 0x10), 0)).toBeNull();
    expect(decodeMidi(bytes(0xf0, 0xf7), 0)).toBeNull();
  });
});

type FakeInput = {
  readonly id: string;
  onmidimessage:
    | ((event: { data: Uint8Array; timeStamp: number }) => void)
    | null;
};

/** A browser with the given device ports, and a way to send each one bytes. */
function fakePorts(
  ids: readonly string[],
): (id: string, data: number[]) => void {
  const inputs = new Map<string, FakeInput>(
    ids.map((id) => [id, { id, onmidimessage: null }]),
  );
  Object.defineProperty(navigator, "requestMIDIAccess", {
    configurable: true,
    value: () => Promise.resolve({ inputs, onstatechange: null }),
  });
  return (id, data) =>
    inputs.get(id)?.onmidimessage?.({
      data: Uint8Array.from(data),
      timeStamp: performance.now(),
    });
}

const listenForGenosSlider = (): SysexListening => ({
  patterns: [genosSlider],
  learning: false,
});

/** A slider step whose last byte the browser is still holding, then the next
 * step, which arrives starting with that byte. */
const openingStep = [
  [0x90, 0x43, 0x10],
  [0x90, 0x4c, 0x10],
  [0x90, 0x00, 0x0b],
];
const followingStep = [
  [0x90, 0x64, 0x43],
  [0x90, 0x10, 0x4c],
  [0x90, 0x10, 0x00],
  [0x90, 0x0b, 0x65],
];

describe("a slider split across ports and reconnects", () => {
  it("keeps each port's held byte apart from what another port sends", async () => {
    const send = fakePorts(["keys-1", "keys-2"]);
    const events: MidiEvent[] = [];
    const disconnect = await connectMidiInputs(
      (event) => events.push(event),
      listenForGenosSlider,
    );
    for (const message of openingStep) send("keys-1", message);
    send("keys-2", [0x90, 60, 90]);
    send("keys-2", [0x90, 60, 0]);
    for (const message of followingStep) send("keys-1", message);
    disconnect();

    expect(notesOf(events)).toEqual(["60+", "60-"]);
    expect(sysexBodiesOf(events).map((body) => body[6])).toEqual([0x64, 0x65]);
  });

  it("remembers a port's held byte across a reconnect", async () => {
    const send = fakePorts(["keys-3"]);
    const events: MidiEvent[] = [];
    const first = await connectMidiInputs(
      (event) => events.push(event),
      listenForGenosSlider,
    );
    for (const message of openingStep) send("keys-3", message);
    first();
    const second = await connectMidiInputs(
      (event) => events.push(event),
      listenForGenosSlider,
    );
    for (const message of followingStep) send("keys-3", message);
    second();

    expect(notesOf(events)).toEqual([]);
    expect(events.filter((event) => event.type === "sysex")).toHaveLength(2);
  });
});
