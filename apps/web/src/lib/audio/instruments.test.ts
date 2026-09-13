import { beforeEach, describe, expect, it, vi } from "vitest";

const attempts: string[] = [];
let failuresLeft = 0;

vi.mock("smplr", () => ({
  Soundfont: class {
    readonly load: Promise<unknown>;
    readonly instrument: string;
    constructor(_context: unknown, options: { instrument: string }) {
      this.instrument = options.instrument;
      attempts.push(options.instrument);
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        this.load = Promise.reject(new Error("network"));
      } else {
        this.load = Promise.resolve(this);
      }
    }
    start(): void {}
    stop(): void {}
  },
  DrumMachine: class {
    readonly load = Promise.resolve(this);
    start(): void {}
    stop(): void {}
  },
}));

const { InstrumentBank } = await import("@/lib/audio/instruments");

function bank(): InstanceType<typeof InstrumentBank> {
  return new InstrumentBank({} as BaseAudioContext);
}

beforeEach(() => {
  attempts.length = 0;
  failuresLeft = 0;
});

describe("InstrumentBank", () => {
  it("loads the instrument a track asks for", async () => {
    const instruments = bank();
    await instruments.warm([{ program: 40, percussion: false }]);
    expect(attempts).toEqual(["violin"]);
  });

  it("keeps the instrument when a fetch fails once, rather than settling for piano", async () => {
    failuresLeft = 1;
    const instruments = bank();
    await instruments.warm([{ program: 40, percussion: false }]);
    expect(attempts).toEqual(["violin", "violin"]);
    expect(attempts).not.toContain("acoustic_grand_piano");
  });

  it("falls back to piano only once the instrument keeps failing", async () => {
    failuresLeft = 99;
    const instruments = bank();
    await instruments.warm([{ program: 40, percussion: false }]);
    expect(attempts.filter((name) => name === "violin").length).toBeGreaterThan(
      1,
    );
    expect(attempts).toContain("acoustic_grand_piano");
  });
});
