import { Midi } from "@tonejs/midi";
import { describe, expect, it } from "vitest";
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
  return { id: pitch, pitch, start: 0, end: 1, velocity: 1, track };
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
