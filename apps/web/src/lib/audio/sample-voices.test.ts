import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Samples } from "@/lib/audio/soundfont-samples";

const loadSoundfont = vi.fn();

vi.mock("@/lib/audio/soundfont-samples", async () => {
  const real = await vi.importActual<
    typeof import("@/lib/audio/soundfont-samples")
  >("@/lib/audio/soundfont-samples");
  return {
    ...real,
    loadSoundfont: (...args: unknown[]) => loadSoundfont(...args),
  };
});

const { SampleVoices } = await import("@/lib/audio/sample-voices");

/** Only the shape the voice player reads: which pitches arrived. */
function samplesFor(pitches: readonly number[]): Samples {
  const byPitch = new Map(
    pitches.map((pitch) => [
      pitch,
      { buffer: {} as AudioBuffer, sustained: false, loopStart: 0, loopEnd: 1 },
    ]),
  );
  return { byPitch, pitches: [...pitches] };
}

function askedFor(call: number): number[] {
  const wanted = loadSoundfont.mock.calls[call]?.[2] as ReadonlySet<number>;
  return [...wanted].sort((first, next) => first - next);
}

describe("loading an instrument's recordings", () => {
  beforeEach(() => {
    loadSoundfont.mockReset();
  });

  it("asks only for the pitches a song plays", async () => {
    loadSoundfont.mockResolvedValue(samplesFor([60, 62]));
    const voices = new SampleVoices({} as BaseAudioContext);

    await voices.load("piano", new Set([60, 62]));

    expect(loadSoundfont).toHaveBeenCalledTimes(1);
    expect(askedFor(0)).toEqual([60, 62]);
  });

  it("leaves the network alone when the next song stays inside the first", async () => {
    loadSoundfont.mockResolvedValue(samplesFor([60, 62, 64]));
    const voices = new SampleVoices({} as BaseAudioContext);

    await voices.load("piano", new Set([60, 62, 64]));
    await voices.load("piano", new Set([62, 64]));

    expect(loadSoundfont).toHaveBeenCalledTimes(1);
  });

  // The recordings outlive the song that first wanted them, so a second song
  // reaching further up the keyboard must not be answered with a neighbour.
  it("fetches only what is missing and keeps what it already had", async () => {
    loadSoundfont
      .mockResolvedValueOnce(samplesFor([60, 62]))
      .mockResolvedValueOnce(samplesFor([84, 86]));
    const voices = new SampleVoices({} as BaseAudioContext);

    await voices.load("piano", new Set([60, 62]));
    const merged = await voices.load("piano", new Set([62, 84, 86]));

    expect(loadSoundfont).toHaveBeenCalledTimes(2);
    expect(askedFor(1)).toEqual([84, 86]);
    expect(merged?.pitches).toEqual([60, 62, 84, 86]);
  });

  it("lets go of an instrument the next song never asks for", async () => {
    loadSoundfont.mockResolvedValue(samplesFor([60]));
    const voices = new SampleVoices({} as BaseAudioContext);

    await voices.load("piano", new Set([60]));
    await voices.load("flute", new Set([60]));
    voices.retain(new Set(["piano"]));
    await voices.load("piano", new Set([60]));
    await voices.load("flute", new Set([60]));

    // Piano was kept, so only the dropped flute had to come back.
    expect(loadSoundfont).toHaveBeenCalledTimes(3);
  });

  it("does not take back an instrument dropped while it was loading", async () => {
    let arrive: (samples: Samples) => void = () => {};
    loadSoundfont.mockReturnValueOnce(
      new Promise<Samples>((resolve) => {
        arrive = resolve;
      }),
    );
    const voices = new SampleVoices({} as BaseAudioContext);

    const loading = voices.load("piano", new Set([60]));
    voices.retain(new Set(["flute"]));
    arrive(samplesFor([60]));

    expect(await loading).toBeNull();
  });

  // One dropped request must not leave those pitches answered by a neighbouring
  // recording for the rest of the session.
  it("asks again for pitches a failed top-up never delivered", async () => {
    loadSoundfont
      .mockResolvedValueOnce(samplesFor([60]))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(samplesFor([84]));
    const voices = new SampleVoices({} as BaseAudioContext);

    await voices.load("piano", new Set([60]));
    await voices.load("piano", new Set([60, 84]));
    const after = await voices.load("piano", new Set([60, 84]));

    expect(loadSoundfont).toHaveBeenCalledTimes(3);
    expect(askedFor(2)).toEqual([84]);
    expect(after?.pitches).toEqual([60, 84]);
  });

  it("forgets a failure so a later song can try again", async () => {
    loadSoundfont
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(samplesFor([60]));
    const voices = new SampleVoices({} as BaseAudioContext);

    expect(await voices.load("piano", new Set([60]))).toBeNull();
    expect(await voices.load("piano", new Set([60]))).not.toBeNull();
    expect(loadSoundfont).toHaveBeenCalledTimes(2);
  });
});
