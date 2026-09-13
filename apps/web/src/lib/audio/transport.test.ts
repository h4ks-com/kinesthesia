import { describe, expect, it } from "vitest";
import { Transport } from "@/lib/audio/transport";

/** A clock the test winds by hand, standing in for the audio device. */
function clock(): { transport: Transport; wind: (seconds: number) => void } {
  let at = 0;
  return {
    transport: new Transport(() => at),
    wind: (seconds: number) => {
      at += seconds;
    },
  };
}

describe("reading the song position", () => {
  it("stays put until it is started", () => {
    const { transport, wind } = clock();

    wind(5);

    expect(transport.position).toBe(0);
    expect(transport.playing).toBe(false);
  });

  it("follows the clock once running", () => {
    const { transport, wind } = clock();

    transport.start();
    wind(2.5);

    expect(transport.position).toBeCloseTo(2.5);
  });

  it("holds where it stopped", () => {
    const { transport, wind } = clock();

    transport.start();
    wind(2);
    transport.pause();
    wind(10);

    expect(transport.position).toBeCloseTo(2);
  });

  it("carries on from where it paused", () => {
    const { transport, wind } = clock();

    transport.start();
    wind(2);
    transport.pause();
    wind(10);
    transport.start();
    wind(1);

    expect(transport.position).toBeCloseTo(3);
  });

  it("counts song seconds, not clock seconds, at speed", () => {
    const { transport, wind } = clock();

    transport.start();
    transport.setRate(2);
    wind(3);

    expect(transport.position).toBeCloseTo(6);
  });

  // The rate change must not move the playhead, only what happens after it.
  it("keeps its place across a change of speed", () => {
    const { transport, wind } = clock();

    transport.start();
    wind(4);
    transport.setRate(0.5);

    expect(transport.position).toBeCloseTo(4);

    wind(4);

    expect(transport.position).toBeCloseTo(6);
  });

  it("takes a seek while it is running without losing the clock", () => {
    const { transport, wind } = clock();

    transport.start();
    wind(5);
    transport.seek(30);
    wind(2);

    expect(transport.position).toBeCloseTo(32);
  });

  it("refuses to be seeked behind the start of the song", () => {
    const { transport } = clock();

    transport.seek(-10);

    expect(transport.position).toBe(0);
  });

  it("ignores a second start, so the position never jumps back", () => {
    const { transport, wind } = clock();

    transport.start();
    wind(3);
    transport.start();
    wind(1);

    expect(transport.position).toBeCloseTo(4);
  });

  it("ignores a pause when it was not running", () => {
    const { transport, wind } = clock();

    transport.start();
    wind(2);
    transport.pause();
    transport.pause();

    expect(transport.position).toBeCloseTo(2);
  });
});
