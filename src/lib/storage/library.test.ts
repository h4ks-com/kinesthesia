import { describe, expect, it } from "vitest";
import {
  entryKey,
  filterLibrary,
  type LibraryEntry,
  matchesLibrary,
} from "@/lib/storage/library";

function entry(name: string, source: string | null = "bitmidi"): LibraryEntry {
  return {
    key: entryKey(source, `https://example.test/${name}.mid`),
    url: `https://example.test/${name}.mid`,
    name,
    source,
    playedAt: 0,
  };
}

describe("matchesLibrary", () => {
  it("keeps everything for an empty query", () => {
    expect(matchesLibrary(entry("Anything"), "")).toBe(true);
    expect(matchesLibrary(entry("Anything"), "   ")).toBe(true);
  });

  it("ignores case", () => {
    expect(matchesLibrary(entry("Bohemian Rhapsody"), "BOHEMIAN")).toBe(true);
  });

  it("matches words in any order", () => {
    const song = entry("Queen - Bohemian Rhapsody");
    expect(matchesLibrary(song, "queen rhap")).toBe(true);
    expect(matchesLibrary(song, "rhapsody queen")).toBe(true);
  });

  it("requires every word", () => {
    expect(matchesLibrary(entry("Bohemian Rhapsody"), "bohemian zelda")).toBe(
      false,
    );
  });

  it("also looks at the source", () => {
    expect(matchesLibrary(entry("Untitled"), "bitmidi")).toBe(true);
  });
});

describe("filterLibrary", () => {
  const library = [
    entry("Queen - Bohemian Rhapsody"),
    entry("Zelda Main Theme"),
    entry("Bohemian Like You"),
  ];

  it("returns the whole library when nothing is typed", () => {
    expect(filterLibrary(library, "")).toHaveLength(3);
  });

  it("narrows to the matches", () => {
    expect(filterLibrary(library, "bohemian").map((row) => row.name)).toEqual([
      "Queen - Bohemian Rhapsody",
      "Bohemian Like You",
    ]);
  });

  it("can come back empty", () => {
    expect(filterLibrary(library, "nothing here")).toEqual([]);
  });
});
