import { describe, expect, it } from "vitest";
import { decodeMidi } from "@/lib/input/web-midi";

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

  it("ignores control changes it does not model", () => {
    expect(decodeMidi(bytes(0xb0, 7, 100), 0)).toBeNull();
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

  it("still ignores controls that are neither sustain nor modulation", () => {
    expect(decodeMidi(bytes(0xb0, 7, 100), 0)).toBeNull();
  });
});
