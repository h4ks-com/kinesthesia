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

  it("ignores control changes other than sustain", () => {
    expect(decodeMidi(bytes(0xb0, 7, 100), 0)).toBeNull();
  });

  it("ignores messages it does not model", () => {
    expect(decodeMidi(bytes(0xe0, 0, 64), 0)).toBeNull();
  });
});
