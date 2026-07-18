import { describe, expect, it } from "vitest";
import { drumGroupFor, pickDrumSample } from "@/lib/audio/percussion";

const kit = [
  "clap",
  "clave",
  "conga-hi",
  "conga-low",
  "conga-mid",
  "cowbell",
  "cymbal",
  "hihat-close",
  "hihat-open",
  "kick",
  "maraca",
  "mid-tom",
  "rimshot",
  "snare",
  "tom-hi",
  "tom-low",
];
const samplesFor = (group: string) => [`${group}/first`, `${group}/second`];

describe("drumGroupFor", () => {
  it("puts the General MIDI staples where they belong", () => {
    expect(drumGroupFor(36)).toBe("kick");
    expect(drumGroupFor(38)).toBe("snare");
    expect(drumGroupFor(42)).toBe("hihat-close");
    expect(drumGroupFor(46)).toBe("hihat-open");
    expect(drumGroupFor(49)).toBe("cymbal");
  });

  it("covers the whole standard kit range", () => {
    for (let note = 35; note <= 81; note += 1) {
      expect(drumGroupFor(note)).not.toBeNull();
    }
  });

  it("has nothing for notes outside the drum map", () => {
    expect(drumGroupFor(20)).toBeNull();
    expect(drumGroupFor(120)).toBeNull();
  });
});

describe("pickDrumSample", () => {
  it("returns a concrete sample from the mapped group", () => {
    expect(pickDrumSample(38, kit, samplesFor)).toBe("snare/first");
  });

  it("falls back when the kit lacks that group", () => {
    const sparse = ["kick", "snare"];
    expect(pickDrumSample(42, sparse, samplesFor)).toBe("snare/first");
  });

  it("still makes a sound for an unmapped note", () => {
    expect(pickDrumSample(120, kit, samplesFor)).toBe("snare/first");
  });

  it("gives up when the kit is empty", () => {
    expect(pickDrumSample(38, [], samplesFor)).toBeNull();
  });
});
