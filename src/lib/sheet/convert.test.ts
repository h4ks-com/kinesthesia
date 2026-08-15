import { describe, expect, it } from "vitest";
import { songToSheetMusic } from "@/lib/sheet/convert";
import type { SheetSource } from "@/lib/sheet/types";

const bpm120Meter44 = { bpm: 120, meter: { beats: 4, value: 4 } } as const;

function baseSource(overrides: Partial<SheetSource> = {}): SheetSource {
  return {
    title: "Test Song",
    notes: [],
    duration: 2,
    key: null,
    ...bpm120Meter44,
    ...overrides,
  };
}

function parse(xml: string): Document {
  return new DOMParser().parseFromString(xml, "application/xml");
}

function measures(doc: Document): Element[] {
  return [...doc.querySelectorAll("part > measure")];
}

function notesOf(measure: Element, staff: 1 | 2): Element[] {
  return [...measure.querySelectorAll("note")].filter(
    (note) => note.querySelector("staff")?.textContent === String(staff),
  );
}

describe("songToSheetMusic", () => {
  it("produces a document with no parser errors", () => {
    const { musicXml } = songToSheetMusic(
      baseSource({ notes: [{ pitch: 60, start: 0, duration: 1 }] }),
    );
    const doc = parse(musicXml);
    expect(doc.querySelector("parsererror")).toBeNull();
    expect(doc.querySelector("score-partwise")).not.toBeNull();
  });

  it("produces one valid whole-rest measure for an empty song", () => {
    const { musicXml, cursorOnsets } = songToSheetMusic(
      baseSource({ notes: [], duration: 0 }),
    );
    const doc = parse(musicXml);
    const list = measures(doc);
    expect(list).toHaveLength(1);
    // One rest per staff, each covering the whole measure.
    const trebleRests = notesOf(list[0] as Element, 1);
    const bassRests = notesOf(list[0] as Element, 2);
    expect(trebleRests).toHaveLength(1);
    expect(bassRests).toHaveLength(1);
    expect(trebleRests[0]?.querySelector("rest")).not.toBeNull();
    expect(trebleRests[0]?.querySelector("type")?.textContent).toBe("whole");
    expect(cursorOnsets).toEqual([0]);
  });

  it("infers enough measures to cover the song's duration at its tempo", () => {
    // 120bpm 4/4: one measure is 2 seconds. A 5 second song needs 3 measures.
    const { musicXml } = songToSheetMusic(baseSource({ duration: 5 }));
    expect(measures(parse(musicXml))).toHaveLength(3);
  });

  it("writes the time signature from the detected meter", () => {
    const { musicXml } = songToSheetMusic(
      baseSource({ meter: { beats: 3, value: 4 }, duration: 3 }),
    );
    const doc = parse(musicXml);
    const time = doc.querySelector("attributes > time");
    expect(time?.querySelector("beats")?.textContent).toBe("3");
    expect(time?.querySelector("beat-type")?.textContent).toBe("4");
  });

  it("writes a rest for a gap before the first note", () => {
    const { musicXml } = songToSheetMusic(
      baseSource({
        notes: [{ pitch: 72, start: 1, duration: 1 }],
        duration: 2,
      }),
    );
    const doc = parse(musicXml);
    const treble = notesOf(measures(doc)[0] as Element, 1);
    expect(treble[0]?.querySelector("rest")).not.toBeNull();
    expect(treble.some((note) => note.querySelector("pitch") !== null)).toBe(
      true,
    );
  });

  it("writes a key signature and spells a flat key's notes without sharps", () => {
    const { musicXml } = songToSheetMusic(
      baseSource({
        key: { tonic: "F", mode: "major" },
        // A Bb (MIDI 70), diatonic in F major.
        notes: [{ pitch: 70, start: 0, duration: 1 }],
        duration: 2,
      }),
    );
    const doc = parse(musicXml);
    expect(doc.querySelector("attributes > key > fifths")?.textContent).toBe(
      "-1",
    );
    const note = doc.querySelector("part > measure note pitch");
    expect(note?.querySelector("step")?.textContent).toBe("B");
    expect(note?.querySelector("alter")?.textContent).toBe("-1");
    // A diatonic note carries no printed accidental: the flat is already in
    // the key signature.
    expect(doc.querySelector("part > measure note accidental")).toBeNull();
  });

  it("marks a natural that contradicts the key signature", () => {
    const { musicXml } = songToSheetMusic(
      baseSource({
        key: { tonic: "F", mode: "major" },
        // B natural (MIDI 71) contradicts F major's printed Bb.
        notes: [{ pitch: 71, start: 0, duration: 1 }],
        duration: 2,
      }),
    );
    const doc = parse(musicXml);
    const note = doc.querySelector("part > measure note");
    expect(note?.querySelector("pitch > alter")).toBeNull();
    expect(note?.querySelector("accidental")?.textContent).toBe("natural");
  });

  it("marks a chromatic note's accidental", () => {
    const { musicXml } = songToSheetMusic(
      baseSource({
        key: { tonic: "C", mode: "major" },
        // C# (MIDI 61) is chromatic in C major.
        notes: [{ pitch: 61, start: 0, duration: 1 }],
        duration: 2,
      }),
    );
    const doc = parse(musicXml);
    const note = doc.querySelector("part > measure note");
    expect(note?.querySelector("pitch > alter")?.textContent).toBe("1");
    expect(note?.querySelector("accidental")?.textContent).toBe("sharp");
  });

  it("ties a note that crosses a barline into two tied notes", () => {
    // 120bpm 4/4: a measure is 16 sixteenths, 2 seconds. A note starting at
    // 1.75s lasting 0.5s spans from unit 14 to unit 18, crossing the barline
    // at unit 16 (1 second before the second measure's start at 2s... the
    // measure boundary itself sits at t=2s, unit 16).
    const { musicXml } = songToSheetMusic(
      baseSource({
        notes: [{ pitch: 60, start: 1.75, duration: 0.5 }],
        duration: 3,
      }),
    );
    const doc = parse(musicXml);
    const list = measures(doc);
    expect(list.length).toBeGreaterThanOrEqual(2);

    const firstMeasureNotes = notesOf(list[0] as Element, 1).filter(
      (note) => note.querySelector("pitch") !== null,
    );
    const lastOfFirst = firstMeasureNotes.at(-1);
    expect(lastOfFirst?.querySelector('tie[type="start"]')).not.toBeNull();
    expect(
      lastOfFirst?.querySelector("notations tied[type='start']"),
    ).not.toBeNull();

    const secondMeasureNotes = notesOf(list[1] as Element, 1).filter(
      (note) => note.querySelector("pitch") !== null,
    );
    const firstOfSecond = secondMeasureNotes[0];
    expect(firstOfSecond?.querySelector('tie[type="stop"]')).not.toBeNull();
    expect(
      firstOfSecond?.querySelector("notations tied[type='stop']"),
    ).not.toBeNull();
  });

  it("keeps a rest from ever carrying a tie", () => {
    const { musicXml } = songToSheetMusic(
      baseSource({ notes: [], duration: 3 }),
    );
    const doc = parse(musicXml);
    for (const rest of doc.querySelectorAll("part > measure note:has(rest)")) {
      expect(rest.querySelector("tie")).toBeNull();
    }
  });

  it("splits notes across the two staves by pitch", () => {
    const { musicXml } = songToSheetMusic(
      baseSource({
        notes: [
          { pitch: 36, start: 0, duration: 1 },
          { pitch: 84, start: 0, duration: 1 },
        ],
        duration: 2,
      }),
    );
    const doc = parse(musicXml);
    const first = measures(doc)[0] as Element;
    const treblePitched = notesOf(first, 1).filter((note) =>
      note.querySelector("pitch"),
    );
    const bassPitched = notesOf(first, 2).filter((note) =>
      note.querySelector("pitch"),
    );
    expect(treblePitched).toHaveLength(1);
    expect(bassPitched).toHaveLength(1);
    expect(treblePitched[0]?.querySelector("octave")?.textContent).toBe("6");
    expect(bassPitched[0]?.querySelector("octave")?.textContent).toBe("2");
  });

  it("reports cursor onsets in ascending order covering both staves", () => {
    const { cursorOnsets } = songToSheetMusic(
      baseSource({
        notes: [
          { pitch: 60, start: 0, duration: 1 },
          { pitch: 36, start: 0.5, duration: 1 },
        ],
        duration: 2,
      }),
    );
    expect(cursorOnsets).toEqual(
      [...cursorOnsets].sort((left, right) => left - right),
    );
    expect(cursorOnsets[0]).toBe(0);
    expect(cursorOnsets).toContain(0.5);
  });

  it("stacks simultaneous notes into a chord in the XML", () => {
    const { musicXml } = songToSheetMusic(
      baseSource({
        notes: [
          // Three low anchor notes pull the song's pitch median well below
          // the chord, so the whole chord lands on one staff rather than
          // being split by the median itself sitting inside it.
          { pitch: 20, start: 1, duration: 0.1 },
          { pitch: 20, start: 1.2, duration: 0.1 },
          { pitch: 20, start: 1.4, duration: 0.1 },
          { pitch: 72, start: 0, duration: 1 },
          { pitch: 76, start: 0, duration: 1 },
          { pitch: 79, start: 0, duration: 1 },
        ],
        duration: 2,
      }),
    );
    const doc = parse(musicXml);
    const first = measures(doc)[0] as Element;
    const chordNotes = notesOf(first, 1).filter((note) =>
      note.querySelector("pitch"),
    );
    expect(chordNotes).toHaveLength(3);
    expect(chordNotes[0]?.querySelector("chord")).toBeNull();
    expect(chordNotes[1]?.querySelector("chord")).not.toBeNull();
    expect(chordNotes[2]?.querySelector("chord")).not.toBeNull();
  });
});

// The title is the one piece of the file's own text written into the document,
// and the document is handed straight to an engraver that builds DOM from it.
describe("a song whose name is markup", () => {
  it("writes the name as text rather than as more document", () => {
    const hostile = "</work-title></work><script>alert(1)</script>";

    const { musicXml } = songToSheetMusic(baseSource({ title: hostile }));

    expect(musicXml).not.toContain("<script>");
    expect(musicXml).toContain("&lt;script&gt;");
    const doc = new DOMParser().parseFromString(musicXml, "application/xml");
    expect(doc.querySelector("parsererror")).toBeNull();
    expect(doc.querySelector("work-title")?.textContent).toBe(hostile);
  });

  // A key nobody notates has no signature to write, and an empty one in the
  // document is what an engraver refuses the whole score over.
  it("falls back to a notatable key when the estimate names none", () => {
    const { musicXml } = songToSheetMusic(
      baseSource({ key: { tonic: "A#", mode: "major" } }),
    );

    const doc = new DOMParser().parseFromString(musicXml, "application/xml");
    const fifths = doc.querySelector("key > fifths")?.textContent ?? "";
    expect(Number.isInteger(Number(fifths))).toBe(true);
    expect(Math.abs(Number(fifths))).toBeLessThanOrEqual(7);
  });
});

// The cursor used to be timed off the written grid at one tempo, so it walked
// away from the music: a note quantised onto the grid is not heard when it is
// written, and a song that changes tempo drifts further with every change.
describe("when each written moment is heard", () => {
  it("times a chord from when it sounds, not from where it is written", () => {
    // Played late against the grid, the way a rolled or rubato chord is.
    const { cursorOnsets } = songToSheetMusic(
      baseSource({
        notes: [
          { pitch: 60, start: 0, duration: 0.5 },
          { pitch: 72, start: 1.37, duration: 0.5 },
        ],
        duration: 4,
      }),
    );

    expect(cursorOnsets).toContain(1.37);
  });

  it("keeps up with playing that does not sit on the grid", () => {
    // Times no 16th-note grid at this tempo lands on, which is what rubato and
    // a tempo change both produce. Reading the clock off the grid rounds every
    // one of these to the wrong moment.
    const notes = [0, 0.47, 0.91, 1.33, 1.52, 1.68, 1.81].map((start) => ({
      pitch: 60,
      start,
      duration: 0.2,
    }));

    const { cursorOnsets } = songToSheetMusic(
      baseSource({ notes, duration: 3 }),
    );

    for (const note of notes) {
      expect(
        cursorOnsets.some((onset) => Math.abs(onset - note.start) < 0.001),
      ).toBe(true);
    }
  });

  it("places a rest between the notes it falls between", () => {
    const { cursorOnsets } = songToSheetMusic(
      baseSource({
        notes: [
          { pitch: 60, start: 0, duration: 0.25 },
          { pitch: 64, start: 2, duration: 0.25 },
        ],
        duration: 4,
      }),
    );

    const between = cursorOnsets.filter((onset) => onset > 0 && onset < 2);
    for (const onset of between) {
      expect(onset).toBeGreaterThan(0);
      expect(onset).toBeLessThan(2);
    }
    expect(cursorOnsets).toEqual([...cursorOnsets].sort((a, b) => a - b));
  });

  // Overlapping notes are how a piano is played, so a reduction that dropped
  // them left the cursor with nothing to stand on for a third of a real piece.
  it("gives every note a moment to be marked, however they overlap", () => {
    const notes = [
      { pitch: 60, start: 0, duration: 3 },
      { pitch: 64, start: 0.4, duration: 2 },
      { pitch: 67, start: 0.75, duration: 0.2 },
      { pitch: 72, start: 1.1, duration: 0.9 },
      { pitch: 48, start: 0.2, duration: 2.5 },
      { pitch: 55, start: 1.6, duration: 0.3 },
    ];
    const { cursorOnsets } = songToSheetMusic(
      baseSource({ notes, duration: 4 }),
    );

    for (const note of notes) {
      const nearest = Math.min(
        ...cursorOnsets.map((onset) => Math.abs(onset - note.start)),
      );
      expect(nearest).toBeLessThan(0.001);
    }
  });
});
