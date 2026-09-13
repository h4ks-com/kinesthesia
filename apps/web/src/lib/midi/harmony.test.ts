import { Midi } from "@tonejs/midi";
import { describe, expect, it } from "vitest";
import { chordAt, nameChord } from "@/lib/midi/harmony";
import { parseSong } from "@/lib/midi/song";

describe("nameChord", () => {
  it("tells a major triad from a minor one", () => {
    expect(nameChord([60, 64, 67])?.quality).toBe("major");
    expect(nameChord([60, 63, 67])?.quality).toBe("minor");
  });

  it("names the root whatever octave the chord is played in", () => {
    // C major, an octave apart and voiced differently each time.
    expect(nameChord([60, 64, 67])?.root).toBe(0);
    expect(nameChord([48, 64, 79])?.root).toBe(0);
  });

  it("hears a diminished and an augmented triad as themselves", () => {
    expect(nameChord([60, 63, 66])?.quality).toBe("diminished");
    expect(nameChord([60, 64, 68])?.quality).toBe("augmented");
  });

  it("says nothing where there is no chord to name", () => {
    expect(nameChord([])).toBeNull();
    expect(nameChord([60])).toBeNull();
  });
});

describe("harmony across a song", () => {
  /** Two bars: C major, then A minor. */
  function twoChords(): ArrayBuffer {
    const midi = new Midi();
    const track = midi.addTrack();
    for (const pitch of [60, 64, 67]) {
      track.addNote({ midi: pitch, time: 4, duration: 1.8 });
    }
    for (const pitch of [57, 60, 64]) {
      track.addNote({ midi: pitch, time: 6, duration: 1.8 });
    }
    return midi.toArray().buffer as ArrayBuffer;
  }

  it("carries a chord timeline a background can read", () => {
    const song = parseSong(twoChords(), "x");
    expect(song.harmony.length).toBeGreaterThan(0);
    expect(chordAt(song.harmony, 4.5).chord?.quality).toBe("major");
    expect(chordAt(song.harmony, 6.5).chord?.quality).toBe("minor");
  });

  it("names nothing over the runway, where nothing is sounding yet", () => {
    const song = parseSong(twoChords(), "x");
    // A timeline whose first entry is the first chord reads as that chord
    // holding from zero, so a background answering the harmony would answer it
    // through the whole lead-in, before a note has been played.
    expect(song.harmony[0]?.at).toBe(0);
    expect(chordAt(song.harmony, 0).chord).toBeNull();
    expect(chordAt(song.harmony, 1).chord).toBeNull();
  });

  it("walks forward from where it last looked without changing the answer", () => {
    const song = parseSong(twoChords(), "x");
    const first = chordAt(song.harmony, 4.5);
    const carried = chordAt(song.harmony, 6.5, first.cursor);
    expect(carried.chord?.quality).toBe("minor");
    // A seek backwards has to find its way home again.
    expect(chordAt(song.harmony, 4.5, carried.cursor).chord?.quality).toBe(
      "major",
    );
  });

  it("knows the key the song sits in", () => {
    const song = parseSong(twoChords(), "x");
    expect(song.key?.mode).toBe("major");
  });
});
