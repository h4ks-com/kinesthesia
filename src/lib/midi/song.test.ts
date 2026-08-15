import { Midi } from "@tonejs/midi";
import { describe, expect, it } from "vitest";
import { blankDigest } from "@/lib/midi/analysis";
import { ExpressionTrail } from "@/lib/midi/expression";
import {
  clampTranspose,
  highestPitch,
  lowestPitch,
  maxMidiBytes,
  parseSong,
  type Song,
  type SongNote,
  transposeSong,
} from "@/lib/midi/song";

function midiStartingAt(firstNoteAt: number): ArrayBuffer {
  const midi = new Midi();
  const track = midi.addTrack();
  track.addNote({ midi: 60, time: firstNoteAt, duration: 0.5 });
  track.addNote({ midi: 64, time: firstNoteAt + 1, duration: 0.5 });
  return midi.toArray().buffer as ArrayBuffer;
}

function note(pitch: number, track: number): SongNote {
  return { id: pitch, pitch, start: 0, end: 1, release: 1, velocity: 1, track };
}

const song: Song = {
  name: "Test",
  duration: 1,
  tracks: [
    {
      index: 0,
      name: "Piano",
      instrument: "acoustic grand piano",
      program: 0,
      percussion: false,
      noteCount: 3,
    },
    {
      index: 1,
      name: "Drums",
      instrument: "standard kit",
      program: 0,
      percussion: true,
      noteCount: 1,
    },
  ],
  notes: [note(60, 0), note(64, 0), note(67, 0), note(38, 1)],
  expression: new ExpressionTrail(),
  harmony: [],
  key: null,
  report: blankDigest("Test"),
  hands: new Map(),
};

function withLine(line: readonly number[]): Song {
  return { ...song, notes: line.map((pitch) => note(pitch, 0)) };
}

function pitches(result: Song, track: number): number[] {
  return result.notes.filter((n) => n.track === track).map((n) => n.pitch);
}

function intervals(line: readonly number[]): number[] {
  return line.slice(1).map((pitch, index) => pitch - (line[index] ?? 0));
}

describe("parseSong lead-in", () => {
  it("gives a song that opens at zero a runway to fall in", () => {
    const parsed = parseSong(midiStartingAt(0), "x");
    expect(parsed.notes[0]?.start).toBeCloseTo(2.5);
    // the gap between the two notes is preserved, only the whole thing moves
    expect(
      (parsed.notes[1]?.start ?? 0) - (parsed.notes[0]?.start ?? 0),
    ).toBeCloseTo(1);
  });

  it("leaves a song that already opens with a gap alone", () => {
    const parsed = parseSong(midiStartingAt(4), "x");
    expect(parsed.notes[0]?.start).toBeCloseTo(4);
  });

  it("runs on after the last note rather than stopping dead on it", () => {
    const parsed = parseSong(midiStartingAt(4), "x");
    const last = parsed.notes[parsed.notes.length - 1]?.end ?? 0;
    expect(parsed.duration).toBeCloseTo(last + 2.5);
  });

  // The report sits beside a clock counting to the song's own length, and the
  // file's duration leaves out the runway added at both ends.
  it("reports the length the clock counts to, not the file's own", () => {
    const parsed = parseSong(midiStartingAt(0), "x");

    expect(parsed.report.durationSeconds).toBeCloseTo(parsed.duration, 1);
  });
});

describe("parseSong rejects bad input", () => {
  it("throws on bytes that are not a MIDI", () => {
    expect(() => parseSong(new Uint8Array([1, 2, 3, 4]).buffer, "x")).toThrow(
      "not a valid MIDI",
    );
  });

  it("throws when a valid MIDI carries no notes", () => {
    const empty = new Midi();
    empty.addTrack();
    expect(() => parseSong(empty.toArray().buffer as ArrayBuffer, "x")).toThrow(
      "no playable notes",
    );
  });

  it("throws when the file is too large", () => {
    expect(() => parseSong(new ArrayBuffer(maxMidiBytes + 1), "x")).toThrow(
      "too large",
    );
  });
});

describe("transposeSong", () => {
  it("moves pitched tracks by the given semitones", () => {
    expect(pitches(transposeSong(song, 2), 0)).toContain(62);
  });

  it("leaves percussion where it is", () => {
    expect(pitches(transposeSong(song, 5), 1)).toEqual([38]);
  });

  it("returns the same song when nothing moves", () => {
    expect(transposeSong(song, 0)).toBe(song);
  });

  it("carries the hand split unchanged, since a uniform shift keeps every gap between notes the same", () => {
    expect(transposeSong(song, 5).hands).toBe(song.hands);
  });

  it("keeps every note on the keyboard", () => {
    const wide = withLine([lowestPitch + 2, 60, highestPitch - 2]);
    for (const shift of [-12, -7, 7, 12] as const) {
      for (const pitch of pitches(transposeSong(wide, shift), 0)) {
        expect(pitch).toBeGreaterThanOrEqual(lowestPitch);
        expect(pitch).toBeLessThanOrEqual(highestPitch);
      }
    }
  });

  it("holds a song that already fills the keyboard where it is", () => {
    const full = withLine([lowestPitch, highestPitch]);
    expect(pitches(transposeSong(full, 5), 0)).toEqual([
      lowestPitch,
      highestPitch,
    ]);
  });

  it("keeps the shape of the line when it runs off the end", () => {
    const shifted = pitches(transposeSong(withLine([100, 104, 106]), 7), 0);
    expect(intervals(shifted)).toEqual(intervals([100, 104, 106]));
    expect(Math.max(...shifted)).toBeLessThanOrEqual(highestPitch);
  });

  it("keeps an octave an octave at the bottom of the keyboard", () => {
    expect(
      intervals(pitches(transposeSong(withLine([24, 36]), -12), 0)),
    ).toEqual([12]);
  });
});

describe("clampTranspose", () => {
  it("holds inside an octave either way", () => {
    expect(clampTranspose(30)).toBe(12);
    expect(clampTranspose(-30)).toBe(-12);
  });

  it("reads a missing or unusable value as the home key", () => {
    expect(clampTranspose(Number.NaN)).toBe(0);
  });

  it("rounds a fractional shift to a semitone", () => {
    expect(clampTranspose(2.4)).toBe(2);
  });
});

describe("parseSong sustain", () => {
  /** Two short notes under one long pedal press, which is the shape a pedalled
   * piano MIDI actually has: the written notes stay short and control 64
   * carries the sound. */
  function pedalled(): ArrayBuffer {
    const midi = new Midi();
    const track = midi.addTrack();
    track.addNote({ midi: 60, time: 4, duration: 0.25 });
    track.addNote({ midi: 64, time: 4.5, duration: 0.25 });
    track.addCC({ number: 64, value: 1, time: 3.9 });
    track.addCC({ number: 64, value: 0, time: 6 });
    return midi.toArray().buffer as ArrayBuffer;
  }

  it("leaves the written length alone so the roll draws what was played", () => {
    const parsed = parseSong(pedalled(), "x");
    const first = parsed.notes[0];
    expect((first?.end ?? 0) - (first?.start ?? 0)).toBeCloseTo(0.25);
  });

  it("carries the sound to the pedal lift", () => {
    const parsed = parseSong(pedalled(), "x");
    for (const note of parsed.notes) {
      expect(note.release).toBeGreaterThan(note.end);
    }
    const lift = parsed.notes[0]?.release ?? 0;
    expect(parsed.notes[1]?.release).toBeCloseTo(lift);
  });

  it("leaves release equal to end when the file has no pedal", () => {
    const parsed = parseSong(midiStartingAt(1), "x");
    for (const note of parsed.notes) {
      expect(note.release).toBe(note.end);
    }
  });

  it("runs on past the pedal lift, not just the last note off", () => {
    const parsed = parseSong(pedalled(), "x");
    const lift = parsed.notes[0]?.release ?? 0;
    expect(parsed.duration).toBeGreaterThan(lift + 2);
  });
});

describe("parseSong expression", () => {
  /** A note under a bend that arrives after it starts, which is how a played
   * bend is written: the note first, the wheel while it rings. */
  function bentMidi(): ArrayBuffer {
    const midi = new Midi();
    const track = midi.addTrack();
    track.addNote({ midi: 60, time: 4, duration: 2 });
    track.addPitchBend({ time: 5, value: 8191 });
    track.addCC({ number: 1, value: 0.5, time: 5.5 });
    return midi.toArray().buffer as ArrayBuffer;
  }

  it("reads the wheels the file writes", () => {
    const parsed = parseSong(bentMidi(), "x");
    expect(parsed.expression.touched(0)).toBe(true);
    expect(parsed.expression.at(0, 5.2).bend).toBeCloseTo(1, 1);
    expect(parsed.expression.at(0, 6).depth).toBeCloseTo(0.5, 1);
  });

  it("leaves the note flat before the wheel moves", () => {
    const parsed = parseSong(bentMidi(), "x");
    expect(parsed.expression.at(0, 4.5).bend).toBe(0);
  });

  it("moves the wheels with the runway, so they line up with the notes", () => {
    const midi = new Midi();
    const track = midi.addTrack();
    // The first note sits at zero, so the whole song is nudged along.
    track.addNote({ midi: 60, time: 0, duration: 2 });
    track.addPitchBend({ time: 1, value: 8191 });
    const parsed = parseSong(midi.toArray().buffer as ArrayBuffer, "x");
    const shift = (parsed.notes[0]?.start ?? 0) - 0;
    expect(parsed.expression.at(0, 1 + shift).bend).toBeCloseTo(1, 1);
    expect(parsed.expression.at(0, 1).bend).toBe(0);
  });

  it("has nothing to read for a file with no wheels", () => {
    const parsed = parseSong(midiStartingAt(1), "x");
    expect(parsed.expression.touched(0)).toBe(false);
  });
});

describe("parseSong wheels on a control track", () => {
  /** A conductor track carrying the wheels for a channel whose notes live on a
   * sibling track, which is what several editors write. */
  function splitMidi(): ArrayBuffer {
    const midi = new Midi();
    const control = midi.addTrack();
    control.channel = 0;
    control.addPitchBend({ time: 5, value: 8191 });
    const voice = midi.addTrack();
    voice.channel = 0;
    voice.addNote({ midi: 60, time: 4, duration: 4 });
    return midi.toArray().buffer as ArrayBuffer;
  }

  it("bends the notes the wheel was written for", () => {
    const parsed = parseSong(splitMidi(), "x");
    const track = parsed.notes[0]?.track ?? -1;
    expect(track).toBeGreaterThanOrEqual(0);
    expect(parsed.expression.at(track, 5.5).bend).toBeCloseTo(1, 1);
  });

  it("leaves a channel that carries no wheel alone", () => {
    const midi = new Midi();
    const bent = midi.addTrack();
    bent.channel = 0;
    bent.addNote({ midi: 60, time: 4, duration: 4 });
    bent.addPitchBend({ time: 5, value: 8191 });
    const plain = midi.addTrack();
    plain.channel = 1;
    plain.addNote({ midi: 67, time: 4, duration: 4 });

    const parsed = parseSong(midi.toArray().buffer as ArrayBuffer, "x");
    const quiet = parsed.notes.find((note) => note.pitch === 67)?.track ?? -1;
    expect(parsed.expression.at(quiet, 5.5).bend).toBe(0);
  });
});
