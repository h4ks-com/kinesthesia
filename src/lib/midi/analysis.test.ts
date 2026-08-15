import { Midi } from "@tonejs/midi";
import { describe, expect, it } from "vitest";
import {
  detectChords,
  detectMeter,
  detectTempo,
  digest,
  estimateKey,
  readableProgression,
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

describe("digest timeline", () => {
  it("names each chord change against real seconds rather than bar numbers", () => {
    const report = digest(
      build({ bpm: 120, meter: [4, 4], chords: [c, c, g, g] }),
      "x",
    );
    // A 4/4 bar at 120bpm is 2 seconds; the chord holds through bar 1 and
    // changes at the start of bar 2.
    expect(report.timeline).toEqual([
      { at: 0, chord: "CM" },
      { at: 4, chord: "GM" },
    ]);
  });
});

function twoTrackMidi(): Midi {
  const midi = new Midi();
  const piano = midi.addTrack();
  piano.instrument.number = 0;
  for (let i = 0; i < 6; i += 1) {
    piano.addNote({ midi: 60 + (i % 3), time: i * 0.5, duration: 0.4 });
  }
  const drums = midi.addTrack();
  drums.channel = 9;
  drums.addNote({ midi: 38, time: 0, duration: 0.1 });
  drums.addNote({ midi: 38, time: 1, duration: 0.1 });
  midi.header.update();
  return new Midi(midi.toArray());
}

describe("digest", () => {
  it("sums notes across tracks and names the busiest one", () => {
    const report = digest(twoTrackMidi(), "Two Tracks");
    expect(report.totalNotes).toBe(8);
    expect(report.playedTrack).toBe(0);
    expect(report.tracks[0]?.notes).toBe(6);
    expect(report.tracks[1]?.notes).toBe(2);
  });

  it("spans the pitch range across every track, not just the busiest", () => {
    const report = digest(twoTrackMidi(), "Two Tracks");
    expect(report.lowestPitch).toBe(38);
    expect(report.highestPitch).toBe(62);
  });

  it("reports notes per second as density", () => {
    const report = digest(twoTrackMidi(), "Two Tracks");
    expect(report.density).toBeCloseTo(
      report.totalNotes / report.durationSeconds,
      1,
    );
  });

  it("carries the full meter rather than only a formatted string", () => {
    const report = digest(build({ bpm: 100, meter: [3, 4], chords: [c] }), "x");
    expect(report.meter).toEqual({
      beats: 3,
      value: 4,
      explicit: true,
      changes: 1,
    });
  });

  it("has no busiest track and a zero pitch span for a file with no notes", () => {
    const empty = new Midi();
    empty.addTrack();
    const report = digest(empty, "Empty");
    expect(report.playedTrack).toBeNull();
    expect(report.lowestPitch).toBe(0);
    expect(report.highestPitch).toBe(0);
    expect(report.totalNotes).toBe(0);
  });
});

describe("readableProgression", () => {
  // Naming what sounds every half second is right for a background asking what
  // is under the playhead and wrong for a progression: a melody crossing a held
  // harmony renames it several times a bar.
  it("folds a passing chord into the one it interrupted", () => {
    const timeline = [
      { at: 0, chord: "C" },
      { at: 4, chord: "Am7" },
      { at: 4.5, chord: "C" },
      { at: 10, chord: "F" },
    ];

    expect(readableProgression(timeline, 20)).toEqual([
      { at: 0, chord: "C" },
      { at: 10, chord: "F" },
    ]);
  });

  it("keeps a chord that holds", () => {
    const timeline = [
      { at: 0, chord: "C" },
      { at: 4, chord: "G" },
    ];

    expect(readableProgression(timeline, 8)).toEqual(timeline);
  });

  // Nothing in a dense passage holds on its own, so letting silence absorb what
  // follows would report the loudest stretch of a song as a gap in it.
  it("never lets a silence swallow the music after it", () => {
    const timeline = [
      { at: 0, chord: null },
      { at: 1, chord: "C" },
      { at: 1.5, chord: "G" },
      { at: 2, chord: "Am" },
    ];

    const kept = readableProgression(timeline, 3);

    expect(kept.length).toBeGreaterThan(1);
    expect(kept[1]?.chord).toBe("C");
  });

  it("says nothing about a song with no chords in it", () => {
    expect(readableProgression([], 10)).toEqual([]);
  });
});
