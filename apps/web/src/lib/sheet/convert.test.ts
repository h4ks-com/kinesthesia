import { describe, expect, it } from "vitest";
import { songToSheetMusic } from "@/lib/sheet/convert";
import { meterGrid, voicesPerStaff } from "@/lib/sheet/notation";
import type { SheetNote, SheetPart, SheetSource } from "@/lib/sheet/types";

const bpm120Meter44 = { bpm: 120, meter: { beats: 4, value: 4 } } as const;

type NoteInput = {
  readonly pitch: number;
  readonly start: number;
  readonly duration: number;
  readonly id?: number;
};

type SourceOverrides = Partial<Omit<SheetSource, "parts">> & {
  readonly notes?: readonly NoteInput[];
  readonly parts?: readonly SheetPart[];
};

/** One piano read across a grand staff unless a test says otherwise, which is
 * the shape every case here was written against. Notes that do not care about
 * their own id get one from their position, so most cases can still write a
 * plain pitch/start/duration literal. */
function baseSource(overrides: SourceOverrides = {}): SheetSource {
  const { notes = [], parts, ...rest } = overrides;
  const withIds: SheetNote[] = notes.map((note, index) => ({
    id: note.id ?? index,
    pitch: note.pitch,
    start: note.start,
    duration: note.duration,
  }));
  return {
    title: "Test Song",
    parts: parts ?? [{ name: "Piano", notes: withIds, split: true }],
    key: null,
    ...bpm120Meter44,
    ...rest,
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

function pitchedNotes(doc: Document, pitch: string): Element[] {
  return [...doc.querySelectorAll("part > measure > note")].filter((note) => {
    const step = note.querySelector("pitch > step")?.textContent ?? "";
    const octave = note.querySelector("pitch > octave")?.textContent ?? "";
    const alter = note.querySelector("pitch > alter")?.textContent ?? "";
    return `${step}${alter}${octave}` === pitch;
  });
}

/** Replays a measure the way a reader does: every note and `<forward>` moves
 * the cursor on, `<chord/>` does not, `<backup>` moves it back. What each
 * voice covers has to be the whole measure or its notes sit at the wrong
 * beats. */
function replayMeasure(measure: Element): {
  readonly covered: ReadonlyMap<string, number>;
  readonly lowest: number;
  readonly end: number;
} {
  const covered = new Map<string, number>();
  let position = 0;
  let lowest = 0;
  for (const child of [...measure.children]) {
    const duration = Number(
      child.querySelector("duration")?.textContent ?? "0",
    );
    if (child.tagName === "backup") {
      position -= duration;
      lowest = Math.min(lowest, position);
      continue;
    }
    if (child.tagName !== "forward" && child.tagName !== "note") {
      continue;
    }
    if (child.querySelector("chord") !== null) {
      continue;
    }
    const voice = child.querySelector("voice")?.textContent ?? "";
    covered.set(voice, (covered.get(voice) ?? 0) + duration);
    position += duration;
  }
  return { covered, lowest, end: position };
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
    const { musicXml, writtenNotes } = songToSheetMusic(
      baseSource({ notes: [] }),
    );
    const doc = parse(musicXml);
    const list = measures(doc);
    expect(list).toHaveLength(1);
    // Nothing is played, so nothing needs a second staff to hold it.
    expect(doc.querySelector("attributes > staves")?.textContent).toBe("1");
    const rests = notesOf(list[0] as Element, 1);
    expect(rests).toHaveLength(1);
    expect(rests[0]?.querySelector("rest")).not.toBeNull();
    expect(rests[0]?.querySelector("type")?.textContent).toBe("whole");
    expect(writtenNotes).toEqual([]);
  });

  // Practising one hand hands the converter that hand's notes alone, and a
  // grand staff whose other half is rests for the whole piece is a page of
  // nothing to play.
  it("writes a one-handed part on the one staff it is played on", () => {
    const melody = [50, 55, 60, 65, 70, 75, 80, 74, 68, 62, 57, 52].map(
      (pitch, index) => ({
        id: index,
        pitch,
        start: index * 0.5,
        duration: 0.4,
      }),
    );
    const { musicXml } = songToSheetMusic(
      baseSource({ parts: [{ name: "Piano", notes: melody, split: true }] }),
    );
    const doc = parse(musicXml);
    expect(doc.querySelector("attributes > staves")?.textContent).toBe("1");
    expect(doc.querySelectorAll("clef")).toHaveLength(1);
    for (const measure of measures(doc)) {
      expect(notesOf(measure, 2)).toHaveLength(0);
    }
  });

  // A file of plain quarter notes has to come out as plain quarter notes. Any
  // constant offset in the note times, a lead in the player added for instance,
  // lands every note off the beat and shatters each one into tied fragments.
  it("writes plain quarter notes as quarter notes", () => {
    const quarters = Array.from({ length: 16 }, (_value, index) => ({
      id: index,
      pitch: 60 + (index % 5),
      // 120bpm: a quarter is half a second.
      start: index * 0.5,
      duration: 0.5,
    }));
    const { musicXml } = songToSheetMusic(
      baseSource({ parts: [{ name: "Piano", notes: quarters, split: false }] }),
    );
    const doc = parse(musicXml);
    const pitched = [...doc.querySelectorAll("note")].filter(
      (note) => note.querySelector("rest") === null,
    );
    expect(pitched).toHaveLength(quarters.length);
    expect(doc.querySelectorAll("tie")).toHaveLength(0);
    for (const note of pitched) {
      expect(note.querySelector("type")?.textContent).toBe("quarter");
    }
  });

  it("infers enough measures to cover the last note actually played", () => {
    // 120bpm 4/4: one measure is 2 seconds. A note ending at 4.5s needs 3.
    const { musicXml } = songToSheetMusic(
      baseSource({ notes: [{ pitch: 60, start: 4.4, duration: 0.1 }] }),
    );
    expect(measures(parse(musicXml))).toHaveLength(3);
  });

  it("writes the time signature from the detected meter", () => {
    const { musicXml } = songToSheetMusic(
      baseSource({ meter: { beats: 3, value: 4 } }),
    );
    const doc = parse(musicXml);
    const time = doc.querySelector("attributes > time");
    expect(time?.querySelector("beats")?.textContent).toBe("3");
    expect(time?.querySelector("beat-type")?.textContent).toBe("4");
  });

  it("writes a rest for a gap before the first note", () => {
    const { musicXml } = songToSheetMusic(
      baseSource({ notes: [{ pitch: 72, start: 1, duration: 1 }] }),
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
      baseSource({ notes: [{ pitch: 60, start: 1.75, duration: 0.5 }] }),
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
    const { musicXml } = songToSheetMusic(baseSource({ notes: [] }));
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

  it("beams a beat of sixteenths and stops the beam at the beat", () => {
    // 120bpm 4/4: a 16th is 0.125s, so eight of them fill the first two beats.
    const { musicXml } = songToSheetMusic(
      baseSource({
        notes: Array.from({ length: 8 }, (_one, index) => ({
          pitch: 72,
          start: index * 0.125,
          duration: 0.125,
        })),
      }),
    );
    const doc = parse(musicXml);
    const beams = [...doc.querySelectorAll('note beam[number="1"]')].map(
      (beam) => beam.textContent,
    );
    expect(beams).toEqual([
      "begin",
      "continue",
      "continue",
      "end",
      "begin",
      "continue",
      "continue",
      "end",
    ]);
    expect(doc.querySelectorAll('note beam[number="2"]')).toHaveLength(8);
  });

  it("stacks simultaneous notes into a chord in the XML", () => {
    const { musicXml } = songToSheetMusic(
      baseSource({
        notes: [
          // A low anchor note struck with the chord is what makes this
          // passage genuinely two-handed, so the chord still has to land on
          // one staff as a unit rather than being split by a median that
          // sits inside its own range.
          { pitch: 20, start: 0, duration: 0.1 },
          { pitch: 20, start: 0.2, duration: 0.1 },
          { pitch: 20, start: 0.4, duration: 0.1 },
          { pitch: 72, start: 0, duration: 1 },
          { pitch: 76, start: 0, duration: 1 },
          { pitch: 79, start: 0, duration: 1 },
        ],
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

// Notes that overlap belong to different voices of the same staff, which is
// what lets each be written once for the length it really sounds.
describe("voices", () => {
  const oneStaff = (notes: readonly NoteInput[]): SheetSource =>
    baseSource({
      parts: [
        {
          name: "Piano",
          notes: notes.map((note, index) => ({
            id: note.id ?? index,
            pitch: note.pitch,
            start: note.start,
            duration: note.duration,
          })),
          split: false,
        },
      ],
    });

  const underAMovingLine: readonly NoteInput[] = [
    { id: 1, pitch: 72, start: 0, duration: 2 },
    { id: 2, pitch: 60, start: 0, duration: 0.5 },
    { id: 3, pitch: 62, start: 0.5, duration: 0.5 },
    { id: 4, pitch: 64, start: 1, duration: 0.5 },
    { id: 5, pitch: 65, start: 1.5, duration: 0.5 },
  ];

  it("writes a held note once, for its whole length", () => {
    const { musicXml } = songToSheetMusic(oneStaff(underAMovingLine));
    const doc = parse(musicXml);
    const held = pitchedNotes(doc, "C5");
    expect(held).toHaveLength(1);
    expect(held[0]?.querySelector("type")?.textContent).toBe("whole");
    expect(held[0]?.querySelector("tie")).toBeNull();
  });

  it("puts the held note and the line that moves under it in different voices", () => {
    const { musicXml } = songToSheetMusic(oneStaff(underAMovingLine));
    const doc = parse(musicXml);
    const heldVoice = pitchedNotes(doc, "C5")[0]?.querySelector(
      "voice",
    )?.textContent;
    const movingVoice = pitchedNotes(doc, "C4")[0]?.querySelector(
      "voice",
    )?.textContent;
    expect(heldVoice).not.toBeUndefined();
    expect(heldVoice).not.toBe(movingVoice);
  });

  it("gives every voice of every measure the whole measure", () => {
    const { musicXml } = songToSheetMusic(
      oneStaff([
        ...underAMovingLine,
        { id: 6, pitch: 74, start: 1.75, duration: 1.5 },
        { id: 7, pitch: 67, start: 2, duration: 0.75 },
        { id: 8, pitch: 69, start: 2.75, duration: 0.25 },
      ]),
    );
    const doc = parse(musicXml);
    const measureUnits = meterGrid(4, 4).measureUnits;
    for (const measure of measures(doc)) {
      const { covered, lowest, end } = replayMeasure(measure);
      expect(lowest).toBe(0);
      expect(end).toBe(measureUnits);
      for (const units of covered.values()) {
        expect(units).toBe(measureUnits);
      }
    }
  });

  it("fills a second voice's silence without printing a rest for it", () => {
    const { musicXml } = songToSheetMusic(
      oneStaff([
        { id: 1, pitch: 72, start: 0, duration: 2 },
        { id: 2, pitch: 60, start: 0, duration: 0.5 },
        { id: 3, pitch: 62, start: 1.5, duration: 0.5 },
      ]),
    );
    const doc = parse(musicXml);
    const secondVoice = pitchedNotes(doc, "C4")[0]?.querySelector(
      "voice",
    )?.textContent;
    const rests = [...doc.querySelectorAll("part > measure > note")].filter(
      (note) =>
        note.querySelector("rest") !== null &&
        note.querySelector("voice")?.textContent === secondVoice,
    );
    expect(rests).toHaveLength(0);
    const forwards = [...doc.querySelectorAll("part > measure > forward")];
    expect(
      forwards.some(
        (one) => one.querySelector("voice")?.textContent === secondVoice,
      ),
    ).toBe(true);
  });

  it("ties a second voice's note across a barline", () => {
    const { musicXml } = songToSheetMusic(
      oneStaff([
        { id: 1, pitch: 60, start: 0, duration: 3 },
        { id: 2, pitch: 64, start: 0, duration: 0.5 },
        { id: 3, pitch: 65, start: 0.5, duration: 0.5 },
        { id: 4, pitch: 67, start: 1, duration: 0.5 },
        { id: 5, pitch: 69, start: 1.5, duration: 0.5 },
        { id: 6, pitch: 71, start: 2, duration: 0.5 },
        { id: 7, pitch: 72, start: 2.5, duration: 0.5 },
      ]),
    );
    const doc = parse(musicXml);
    const held = pitchedNotes(doc, "C4");
    expect(held).toHaveLength(2);
    expect(held[0]?.querySelector('tie[type="start"]')).not.toBeNull();
    expect(held[1]?.querySelector('tie[type="stop"]')).not.toBeNull();
    expect(held[0]?.closest("measure")?.getAttribute("number")).toBe("1");
    expect(held[1]?.closest("measure")?.getAttribute("number")).toBe("2");
  });

  it("numbers the second staff's voices after the first staff's", () => {
    const { musicXml } = songToSheetMusic(
      baseSource({
        notes: [
          { pitch: 84, start: 0, duration: 2 },
          { pitch: 79, start: 0, duration: 0.5 },
          { pitch: 36, start: 0, duration: 2 },
          { pitch: 43, start: 0, duration: 0.5 },
        ],
      }),
    );
    const doc = parse(musicXml);
    for (const measure of measures(doc)) {
      for (const staff of [1, 2] as const) {
        for (const note of notesOf(measure, staff)) {
          const voice = Number(note.querySelector("voice")?.textContent ?? "0");
          expect(voice > (staff - 1) * voicesPerStaff).toBe(true);
          expect(voice <= staff * voicesPerStaff).toBe(true);
        }
      }
    }
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

// The identity design: every written note carries the source note ids it
// sounds for, found again by a page that has rendered this MusicXML rather
// than by counting onsets against a clock.
describe("written notes carry the id of the source note they sound for", () => {
  it("keeps a single note's id on its one written note", () => {
    const { writtenNotes } = songToSheetMusic(
      baseSource({ notes: [{ id: 42, pitch: 60, start: 0, duration: 1 }] }),
    );
    expect(writtenNotes).toHaveLength(1);
    expect(writtenNotes[0]?.ids).toEqual([42]);
    expect(writtenNotes[0]?.pitch).toBe(60);
    expect(writtenNotes[0]?.staff).toBe(1);
    expect(writtenNotes[0]?.measureIndex).toBe(0);
  });

  it("keeps each overlapping note's own id, however they overlap", () => {
    const notes = [
      { id: 1, pitch: 60, start: 0, duration: 3 },
      { id: 2, pitch: 64, start: 0.4, duration: 2 },
      { id: 3, pitch: 67, start: 0.75, duration: 0.2 },
      { id: 4, pitch: 72, start: 1.1, duration: 0.9 },
    ];
    const { writtenNotes } = songToSheetMusic(baseSource({ notes }));

    for (const note of notes) {
      expect(
        writtenNotes.some((written) => written.ids.includes(note.id)),
      ).toBe(true);
    }
  });

  it("puts a note tied across a barline on more than one written note", () => {
    const { writtenNotes } = songToSheetMusic(
      baseSource({ notes: [{ id: 9, pitch: 60, start: 1.75, duration: 0.5 }] }),
    );
    const owned = writtenNotes.filter((written) => written.ids.includes(9));
    expect(owned.length).toBeGreaterThanOrEqual(2);
    expect(owned.map((written) => written.measureIndex).sort()).toEqual([0, 1]);
  });

  it("groups a doubled unison's ids onto the one written pitch", () => {
    const { writtenNotes } = songToSheetMusic(
      baseSource({
        notes: [
          { id: 1, pitch: 60, start: 0, duration: 1 },
          { id: 2, pitch: 60, start: 0, duration: 1 },
        ],
      }),
    );
    expect(writtenNotes).toHaveLength(1);
    expect([...(writtenNotes[0]?.ids ?? [])].sort()).toEqual([1, 2]);
  });

  it("keeps a hand's id on whichever staff the split puts it on", () => {
    const { writtenNotes } = songToSheetMusic(
      baseSource({
        notes: [
          { id: 1, pitch: 84, start: 0, duration: 1 },
          { id: 2, pitch: 36, start: 0, duration: 1 },
        ],
      }),
    );
    const treble = writtenNotes.find((written) => written.ids.includes(1));
    const bass = writtenNotes.find((written) => written.ids.includes(2));
    expect(treble?.staff).toBe(1);
    expect(bass?.staff).toBe(2);
  });

  it("marks every instrument's own part index", () => {
    const band: readonly SheetPart[] = [
      {
        name: "Lead",
        notes: [{ id: 10, pitch: 72, start: 0.5, duration: 0.5 }],
        split: false,
      },
      {
        name: "Bass",
        notes: [{ id: 20, pitch: 40, start: 1.25, duration: 0.5 }],
        split: false,
      },
    ];
    const { writtenNotes } = songToSheetMusic(baseSource({ parts: band }));
    expect(
      writtenNotes.find((written) => written.ids.includes(10))?.partIndex,
    ).toBe(0);
    expect(
      writtenNotes.find((written) => written.ids.includes(20))?.partIndex,
    ).toBe(1);
  });

  // A single detected tempo is one grid every note in the file reads time
  // against; a note whose real timestamp falls late for that grid is exactly
  // what a tempo change elsewhere in the piece produces, and the score used to
  // size itself off the audio's own wall-clock length instead of that grid,
  // so a late-enough note could fall past the last measure and go unwritten.
  it("ends the score when the last note does, however a tempo change shaped it", () => {
    // 60bpm 4/4: one measure is 4 seconds. A note whose grid position falls
    // at 7.9s needs a second measure it would not get from a shorter duration
    // read off real time alone.
    const { writtenNotes } = songToSheetMusic(
      baseSource({
        bpm: 60,
        notes: [{ id: 5, pitch: 60, start: 7.9, duration: 0.3 }],
      }),
    );
    expect(writtenNotes.some((written) => written.ids.includes(5))).toBe(true);
  });
});
