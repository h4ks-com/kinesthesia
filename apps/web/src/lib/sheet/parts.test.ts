import { describe, expect, it } from "vitest";
import { sheetParts } from "@/lib/sheet/parts";

const piano = { index: 0, name: "Piano", percussion: false };
const bass = { index: 1, name: "Bass", percussion: false };
const drums = { index: 9, name: "Drums", percussion: true };

let nextId = 0;

function note(track: number, pitch: number, start: number) {
  nextId += 1;
  return { id: nextId, track, pitch, start, duration: 0.5 };
}

describe("sheetParts", () => {
  it("reads one instrument across a grand staff, which is its two hands", () => {
    const parts = sheetParts({
      tracks: [piano],
      notes: [note(0, 40, 0), note(0, 76, 0)],
    });
    expect(parts).toHaveLength(1);
    expect(parts[0]?.split).toBe(true);
  });

  it("gives each instrument its own line and divides no hands", () => {
    const parts = sheetParts({
      tracks: [piano, bass],
      notes: [note(0, 72, 0), note(1, 40, 0)],
    });
    expect(parts.map((part) => part.name)).toEqual(["Piano", "Bass"]);
    expect(parts.every((part) => !part.split)).toBe(true);
    expect(parts[1]?.notes.map((one) => one.pitch)).toEqual([40]);
  });

  // Silencing a track is how someone says what they want to read.
  it("leaves out a track nothing is heard from", () => {
    const parts = sheetParts({
      tracks: [piano, bass],
      notes: [note(0, 72, 0), note(0, 48, 1)],
    });
    expect(parts).toHaveLength(1);
    expect(parts[0]?.name).toBe("Piano");
    // Alone on the page, it is read as a keyboard part again.
    expect(parts[0]?.split).toBe(true);
  });

  it("keeps drums off a staff that cannot say what they are", () => {
    const parts = sheetParts({
      tracks: [piano, drums],
      notes: [note(0, 72, 0), note(9, 38, 0)],
    });
    expect(parts).toHaveLength(1);
    expect(parts[0]?.name).toBe("Piano");
  });

  it("writes nothing for a song with nothing to hear", () => {
    expect(sheetParts({ tracks: [piano], notes: [] })).toEqual([]);
  });

  it("names a part the file left unnamed", () => {
    const parts = sheetParts({
      tracks: [{ index: 3, name: "", percussion: false }],
      notes: [note(3, 60, 0)],
    });
    expect(parts[0]?.name).toBe("Part 4");
  });
});

describe("a score of many instruments", () => {
  it("keeps the busiest lines and no more than a page can carry", () => {
    const tracks = Array.from({ length: 14 }, (_value, index) => ({
      index,
      name: `Part ${index}`,
      percussion: false,
    }));
    // Later tracks play more, so the quiet early ones are the ones to drop.
    const notes = tracks.flatMap((track) =>
      Array.from({ length: track.index + 1 }, (_value, at) =>
        note(track.index, 60, at * 0.5),
      ),
    );

    const parts = sheetParts({ tracks, notes });

    expect(parts).toHaveLength(10);
    expect(parts.map((part) => part.name)).toEqual(
      tracks.slice(4).map((track) => track.name),
    );
  });
});
