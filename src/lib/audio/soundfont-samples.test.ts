import { describe, expect, it } from "vitest";
import { readSoundfontFile } from "@/lib/audio/soundfont-samples";

/** What the soundfont host actually serves: two guard statements, an
 * assignment, and an object that ends on a trailing comma. */
const real = `if (typeof(MIDI) === 'undefined') var MIDI = {};
if (typeof(MIDI.Soundfont) === 'undefined') MIDI.Soundfont = {};
MIDI.Soundfont.overdriven_guitar = {
"A0": "data:audio/mp3;base64,AAAA",
"C#4": "data:audio/mp3;base64,BBBB",
}
`;

describe("reading a soundfont file", () => {
  it("takes the assigned object, not the guard braces above it", () => {
    expect(Object.keys(readSoundfontFile(real))).toEqual(["A0", "C#4"]);
  });

  it("survives the trailing comma the host leaves in", () => {
    expect(readSoundfontFile(real).A0).toBe("data:audio/mp3;base64,AAAA");
  });

  it("says nothing rather than throwing on something it cannot read", () => {
    expect(readSoundfontFile("var MIDI = {};")).toEqual({});
    expect(readSoundfontFile("")).toEqual({});
  });

  /** A blocked network answers with its own page, at status 200. Those braces
   * reach the parser, so refusing them is what keeps a captive portal from
   * taking the sound down with it. */
  it("refuses a block page rather than throwing", () => {
    expect(readSoundfontFile("<html><body>Blocked{x}</body></html>")).toEqual(
      {},
    );
    expect(readSoundfontFile("MIDI.Soundfont.x = { oops }")).toEqual({});
  });

  it("keeps only the samples that are actually text", () => {
    const mixed = 'MIDI.Soundfont.x = { "A0": "data:1", "B0": 5, "C0": null }';
    expect(readSoundfontFile(mixed)).toEqual({ A0: "data:1" });
  });
});
