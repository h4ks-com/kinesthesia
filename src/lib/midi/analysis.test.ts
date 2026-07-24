import { Midi } from "@tonejs/midi";
import { describe, expect, it } from "vitest";
import {
  detectChords,
  detectMeter,
  detectTempo,
  estimateKey,
} from "@/lib/midi/analysis";

type Build = {
  bpm: number;
  meter: [number, number];
  chords: readonly (readonly number[])[];
  arp?: boolean;
};

function build({ bpm, meter, chords, arp = false }: Build): Midi {
  const midi = new Midi();
  midi.header.tempos = [{ ticks: 0, bpm }];
  midi.header.timeSignatures = [{ ticks: 0, timeSignature: meter }];
  midi.header.update();
  const track = midi.addTrack();
  const ppq = midi.header.ppq;
  const barTicks = ppq * meter[0] * (4 / meter[1]);
  chords.forEach((notes, bar) => {
    const start = bar * barTicks;
    notes.forEach((pitch, index) => {
      const step = barTicks / notes.length;
      track.addNote({
        midi: pitch,
        ticks: arp ? start + index * step : start,
        durationTicks: arp ? step : barTicks,
      });
    });
  });
  return new Midi(midi.toArray());
}

const c = [60, 64, 67];
const g = [67, 71, 74];
const aMinor = [69, 72, 76];
const f = [65, 69, 72];
const dMinor = [62, 65, 69];

describe("detectTempo", () => {
  it("reads the tempo straight from the header", () => {
    expect(
      detectTempo(build({ bpm: 100, meter: [4, 4], chords: [c] })).bpm,
    ).toBe(100);
    expect(
      detectTempo(build({ bpm: 90, meter: [3, 4], chords: [c] })).bpm,
    ).toBe(90);
  });
});

describe("detectMeter", () => {
  it("reads the time signature from the header", () => {
    const meter = detectMeter(build({ bpm: 100, meter: [3, 4], chords: [c] }));
    expect([meter.beats, meter.value]).toEqual([3, 4]);
    expect(meter.explicit).toBe(true);
  });
});

describe("estimateKey", () => {
  it("finds C major", () => {
    const key = estimateKey(
      build({ bpm: 100, meter: [4, 4], chords: [c, g, aMinor, f] }),
    );
    expect(key?.tonic).toBe("C");
    expect(key?.mode).toBe("major");
  });

  it("finds A minor and reports it against its relative major", () => {
    const key = estimateKey(
      build({
        bpm: 90,
        meter: [3, 4],
        chords: [aMinor, dMinor, [64, 68, 71], aMinor],
      }),
    );
    expect(key?.tonic).toBe("A");
    expect(key?.mode).toBe("minor");
  });
});

describe("detectChords", () => {
  it("names a block progression", () => {
    const spans = detectChords(
      build({ bpm: 100, meter: [4, 4], chords: [c, g, aMinor, f] }),
    );
    expect(spans.map((span) => span.chord)).toEqual(["CM", "GM", "Am", "FM"]);
  });

  it("names the same progression when it is arpeggiated", () => {
    const spans = detectChords(
      build({ bpm: 100, meter: [4, 4], chords: [c, g, aMinor, f], arp: true }),
    );
    expect(spans.map((span) => span.chord)).toEqual(["CM", "GM", "Am", "FM"]);
  });

  it("returns null for a single note", () => {
    const spans = detectChords(
      build({ bpm: 100, meter: [4, 4], chords: [[60]] }),
    );
    expect(spans[0]?.chord).toBeNull();
  });
});
