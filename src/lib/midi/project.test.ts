import { describe, expect, it } from "vitest";
import { detectChords, readMidi } from "@/lib/midi/analysis";
import {
  addChords,
  addNotes,
  addText,
  createProject,
  duplicate,
  EditError,
  insertBars,
  projectBars,
  projectBytes,
  projectDigest,
  setTempo,
  transpose,
} from "@/lib/midi/project";

function base() {
  return createProject("pj_test", { name: "test", bpm: 90 });
}

describe("addChords", () => {
  it("adds a block chord bed on a new track and reads back as those chords", () => {
    const project = addChords(base(), {
      track: "new",
      channel: 1,
      chords: ["Am7", "Dm7", "G7", "Cmaj7"],
      style: "block",
      octave: 3,
    });
    expect(project.tracks).toHaveLength(1);
    expect(project.tracks[0]?.channel).toBe(1);
    const spans = detectChords(readMidi(projectBytes(project)));
    expect(spans.map((span) => span.chord)).toEqual([
      "Am7",
      "Dm7",
      "G7",
      "Cmaj7",
    ]);
  });

  it("layers a second track without touching the first", () => {
    const one = addChords(base(), { track: "new", channel: 0, chords: ["C"] });
    const two = addChords(one, {
      track: "new",
      channel: 1,
      chords: ["C"],
      style: "up",
    });
    expect(two.tracks).toHaveLength(2);
    expect(two.tracks[0]?.notes.length).toBe(one.tracks[0]?.notes.length);
  });

  it("refuses a chord it cannot read", () => {
    expect(() => addChords(base(), { chords: ["Zzz"] })).toThrow(EditError);
  });
});

describe("addText", () => {
  it("places a word on its own channel as white-key notes", () => {
    const project = addText(base(), { track: "new", channel: 2, text: "HI" });
    expect(project.tracks[0]?.channel).toBe(2);
    expect(project.tracks[0]?.notes.length).toBeGreaterThan(0);
  });
});

describe("duplicate", () => {
  it("copies a bar range forward, extending the piece", () => {
    const four = addChords(base(), {
      track: "new",
      channel: 0,
      chords: ["C", "F", "G", "C"],
    });
    expect(projectBars(four)).toBe(4);
    const looped = duplicate(four, {
      fromBar: 1,
      toBar: 4,
      atBar: 5,
      times: 1,
    });
    expect(projectBars(looped)).toBe(8);
  });
});

describe("transpose", () => {
  it("moves every note by an interval", () => {
    const project = addChords(base(), { track: "new", chords: ["C"] });
    const up = transpose(project, { by: "P5" });
    const before = project.tracks[0]?.notes[0]?.pitch ?? 0;
    const after = up.tracks[0]?.notes[0]?.pitch ?? 0;
    expect(after - before).toBe(7);
  });

  it("refuses a transpose that runs off the keyboard", () => {
    const high = addChords(base(), { track: "new", chords: ["C"], octave: 7 });
    expect(() => transpose(high, { by: 48 })).toThrow(EditError);
  });
});

describe("setTempo", () => {
  it("changes the tempo while the beat-timed notes stay put", () => {
    const project = addChords(base(), { track: "new", chords: ["C", "G"] });
    const faster = setTempo(project, 140);
    expect(faster.bpm).toBe(140);
    expect(projectBars(faster)).toBe(projectBars(project));
  });
});

describe("projectDigest", () => {
  it("reports bars, tracks with channels, and the harmony timeline", () => {
    const project = addChords(base(), {
      track: "new",
      channel: 4,
      chords: ["C", "G"],
    });
    const summary = projectDigest(project);
    expect(summary.bars).toBe(2);
    expect(summary.tracks[0]?.channel).toBe(4);
    expect(summary.harmony.map((span) => span.chord)).toEqual(["CM", "GM"]);
  });
});

describe("append and insert", () => {
  it("appends after the last bar when no atBar is given", () => {
    const first = addChords(base(), { track: "new", chords: ["C", "G"] });
    const appended = addChords(first, { track: 0, chords: ["Am", "F"] });
    expect(projectBars(appended)).toBe(4);
  });

  it("insertBars prepends by pushing existing content later", () => {
    const two = addChords(base(), { track: "new", chords: ["C", "G"] });
    const shifted = insertBars(two, { atBar: 1, bars: 2 });
    const firstStart = Math.min(
      ...(shifted.tracks[0]?.notes.map((note) => note.startBeat) ?? [0]),
    );
    expect(firstStart).toBe(2 * shifted.beatsPerBar);
    const prepended = addChords(shifted, {
      track: 0,
      atBar: 1,
      chords: ["Dm", "E7"],
    });
    expect(projectBars(prepended)).toBe(4);
  });
});

describe("addText wrapping", () => {
  it("wraps a long phrase into several time-stacked lines", () => {
    const project = addText(base(), {
      track: "new",
      text: "HELLO WORLD FROM MIDI",
      basePitch: 36,
    });
    const times = project.tracks[0]?.notes.map((note) => note.startBeat) ?? [];
    expect(Math.max(...times) - Math.min(...times)).toBeGreaterThan(7);
  });
});

describe("addNotes", () => {
  it("places well-formed notes", () => {
    const project = addNotes(base(), {
      track: "new",
      notes: [{ note: "C4", at: "1:1", dur: "1/4" }],
    });
    expect(project.tracks[0]?.notes[0]?.pitch).toBe(60);
  });

  it("refuses a malformed position or duration rather than emitting NaN", () => {
    expect(() =>
      addNotes(base(), {
        track: "new",
        notes: [{ note: "C4", at: "1:x", dur: "1/4" }],
      }),
    ).toThrow(EditError);
    expect(() =>
      addNotes(base(), {
        track: "new",
        notes: [{ note: "C4", at: "1:1", dur: "1/x" }],
      }),
    ).toThrow(EditError);
  });
});

describe("sustained arpeggio", () => {
  it("rings the first tone across the whole bar", () => {
    const project = addChords(base(), {
      track: "new",
      chords: ["C"],
      style: "up",
    });
    const longest = Math.max(
      ...(project.tracks[0]?.notes.map((note) => note.durationBeats) ?? [0]),
    );
    expect(longest).toBe(4);
  });
});
