import { describe, expect, it } from "vitest";
import { ranked } from "@/server/midi/relevance";
import type { MidiListing } from "@/server/midi/types";

function listing(name: string, plays = 0): MidiListing {
  return {
    id: name,
    source: "bitmidi",
    name,
    plays,
    sourceUrl: `https://example.test/${name}`,
  };
}

const names = (listings: readonly MidiListing[]) =>
  listings.map((entry) => entry.name);

describe("ranked", () => {
  // What bitmidi answers "maria mag" with: the only file carrying both words
  // comes back last, behind fifty that carry one.
  it("leads with what carries every word, and keeps the rest below", () => {
    const found = [
      listing("Clannad - Mag Mell.mid"),
      listing("Ave-Maria-1.mid"),
      listing("SANDRA.Maria Magdalena K.mid"),
    ];

    expect(names(ranked(found, "maria mag"))).toEqual([
      "SANDRA.Maria Magdalena K.mid",
      "Clannad - Mag Mell.mid",
      "Ave-Maria-1.mid",
    ]);
  });

  it("reads a name's punctuation as a space", () => {
    const found = [
      listing("Santana - Maria Maria.mid"),
      listing("SANDRA.Maria Magdalena K.mid"),
    ];

    expect(names(ranked(found, "sandra maria"))[0]).toBe(
      "SANDRA.Maria Magdalena K.mid",
    );
  });

  // A source matches names we never see: bitmidi searches alternate titles
  // too, so a top hit carrying the word nowhere in its name is still the right
  // answer and is left where the source put it.
  it("leaves the source's own order alone for one word", () => {
    const found = [listing("Fur-Elise.mid"), listing("Bagatelle-No-25.mid")];

    expect(names(ranked(found, "bagatelle"))).toEqual([
      "Fur-Elise.mid",
      "Bagatelle-No-25.mid",
    ]);
  });

  it("puts the more played of two equal matches first", () => {
    const found = [
      listing("Maria Magdalena live.mid", 12),
      listing("Maria Magdalena.mid", 2695),
    ];

    expect(names(ranked(found, "maria mag"))).toEqual([
      "Maria Magdalena.mid",
      "Maria Magdalena live.mid",
    ]);
  });
});
