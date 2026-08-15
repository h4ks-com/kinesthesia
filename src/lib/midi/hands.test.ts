import { describe, expect, it } from "vitest";
import { assignHands, type Hand, looksTwoHanded } from "@/lib/midi/hands";
import type { SongNote } from "@/lib/midi/song";

let nextId = 0;

function note(pitch: number, start: number, duration = 0.3): SongNote {
  nextId += 1;
  return {
    id: nextId,
    pitch,
    start,
    end: start + duration,
    release: start + duration,
    velocity: 0.8,
    track: 0,
  };
}

/** The threshold a naive splitter would use, which the DP has to beat: a
 * pitch either side of middle C, no context taken into account. */
function naiveHand(pitch: number): Hand {
  return pitch < 60 ? "left" : "right";
}

describe("assignHands", () => {
  it("splits a bass line under a melody the way a musician would", () => {
    const bassPitches = [43, 45, 47, 43, 45, 47];
    const melodyPitches = [74, 76, 79, 74, 76, 79];
    const notes: SongNote[] = [];
    const pairs: { bass: SongNote; melody: SongNote }[] = [];
    bassPitches.forEach((bass, index) => {
      const start = index * 0.5;
      const bassNote = note(bass, start);
      const melodyNote = note(melodyPitches[index] ?? 0, start);
      notes.push(bassNote, melodyNote);
      pairs.push({ bass: bassNote, melody: melodyNote });
    });

    const assigned = assignHands(notes);

    for (const { bass, melody } of pairs) {
      expect(assigned.get(bass.id)).toBe("left");
      expect(assigned.get(melody.id)).toBe("right");
    }
  });

  it("keeps a wide left-hand arpeggio reaching above middle C in the left hand", () => {
    // Paired at every step with a right-hand note held well above it, so the
    // pairing - not an absolute pitch line - is what decides each side.
    const arpeggio = [43, 48, 53, 58, 62, 58, 53, 48];
    const notes: SongNote[] = [];
    const leftNotes: SongNote[] = [];
    for (const [index, pitch] of arpeggio.entries()) {
      const start = index * 0.3;
      const left = note(pitch, start);
      notes.push(left, note(79, start));
      leftNotes.push(left);
    }

    const assigned = assignHands(notes);

    for (const left of leftNotes) {
      expect(assigned.get(left.id)).toBe("left");
    }
    // The naive threshold gets the highest arpeggio note wrong: it crosses
    // above middle C, which is exactly the case a fixed line misreads.
    const crossesMiddleC = leftNotes.some((left) => left.pitch >= 60);
    expect(crossesMiddleC).toBe(true);
    const misreadByNaive = leftNotes.some(
      (left) => naiveHand(left.pitch) !== assigned.get(left.id),
    );
    expect(misreadByNaive).toBe(true);
  });

  it("splits a chord spanning both hands at a playable point", () => {
    const start = 0;
    const bass = [36, 40, 43].map((pitch) => note(pitch, start));
    const treble = [64, 67, 71].map((pitch) => note(pitch, start));
    const notes = [...bass, ...treble];

    const assigned = assignHands(notes);

    for (const each of bass) {
      expect(assigned.get(each.id)).toBe("left");
    }
    for (const each of treble) {
      expect(assigned.get(each.id)).toBe("right");
    }
    const span = (side: SongNote[]) =>
      Math.max(...side.map((each) => each.pitch)) -
      Math.min(...side.map((each) => each.pitch));
    expect(span(bass)).toBeLessThanOrEqual(12);
    expect(span(treble)).toBeLessThanOrEqual(12);
  });

  it("is deterministic across repeated runs on the same notes", () => {
    const notes = [
      note(43, 0),
      note(76, 0),
      note(47, 0.5),
      note(79, 0.5),
      note(55, 1.2),
      note(58, 1.2),
      note(60, 1.2),
      note(84, 1.9),
    ];
    const first = assignHands(notes);
    const second = assignHands(notes);
    expect([...second.entries()].sort()).toEqual([...first.entries()].sort());
  });

  it("does not crash on a monophonic single line and assigns every note", () => {
    const notes = [60, 62, 64, 65, 67, 69, 71, 72].map((pitch, index) =>
      note(pitch, index * 0.4),
    );

    const assigned = assignHands(notes);

    expect(assigned.size).toBe(notes.length);
    for (const each of notes) {
      const hand = assigned.get(each.id);
      expect(hand === "left" || hand === "right").toBe(true);
    }
  });

  it("keeps a close cluster with the hand that was recently active", () => {
    // A beat with no right-hand note at all: three close notes, locally free
    // to split any way, sandwiched between beats that clearly establish the
    // left hand down here and the right hand up at 90. Continuity, not the
    // notes' own span, is what has to keep them together on the left.
    const before = [note(40, 0), note(90, 0)];
    const cluster = [note(46, 1), note(49, 1), note(52, 1)];
    const after = [note(40, 2), note(90, 2)];
    const notes = [...before, ...cluster, ...after];

    const assigned = assignHands(notes);

    for (const each of cluster) {
      expect(assigned.get(each.id)).toBe("left");
    }
  });

  it("handles an empty part", () => {
    expect(assignHands([]).size).toBe(0);
  });

  it("stays fast on a large synthetic song", () => {
    const notes: SongNote[] = [];
    for (let bar = 0; bar < 2500; bar += 1) {
      const start = bar * 0.5;
      notes.push(note(40 + (bar % 12), start));
      notes.push(note(43 + (bar % 12), start));
      notes.push(note(72 + (bar % 12), start + 0.05));
      notes.push(note(76 + (bar % 12), start + 0.05));
    }
    expect(notes.length).toBeGreaterThanOrEqual(10000);

    const startedAt = performance.now();
    assignHands(notes);
    const elapsed = performance.now() - startedAt;

    expect(elapsed).toBeLessThan(3000);
  });
});

describe("looksTwoHanded", () => {
  it("is true for a real two-hand texture", () => {
    const notes: SongNote[] = [];
    for (let index = 0; index < 20; index += 1) {
      const start = index * 0.3;
      notes.push(note(43 + (index % 5), start));
      notes.push(note(76 + (index % 5), start));
    }
    expect(looksTwoHanded(notes)).toBe(true);
  });

  it("is false for a single melodic line", () => {
    const notes = Array.from({ length: 20 }, (_, index) =>
      note(60 + (index % 7), index * 0.3),
    );
    expect(looksTwoHanded(notes)).toBe(false);
  });

  it("is false for too short a part to tell", () => {
    const notes = [note(48, 0), note(72, 0)];
    expect(looksTwoHanded(notes)).toBe(false);
  });
});
