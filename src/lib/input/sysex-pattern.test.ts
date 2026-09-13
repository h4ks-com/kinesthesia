import { describe, expect, it } from "vitest";
import {
  genosSlider,
  rolandDataSet,
  rolandSlider,
} from "@/lib/input/sysex-fixtures";
import {
  learnPattern,
  matchesPattern,
  patternHeadLength,
  patternsOverlap,
  patternValue,
} from "@/lib/input/sysex-pattern";

describe("learning a SysEx control from two of its messages", () => {
  it("reads a Yamaha parameter change as its address and a position", () => {
    const pattern = learnPattern([
      [0x43, 0x10, 0x4c, 0x10, 0x00, 0x0b, 0x78],
      [0x43, 0x10, 0x4c, 0x10, 0x00, 0x0b, 0x76],
    ]);
    expect(pattern).toEqual(genosSlider);
  });

  it("takes a Roland position ahead of the checksum that follows it", () => {
    const pattern = learnPattern([rolandDataSet(10), rolandDataSet(11)]);
    expect(pattern).toEqual(rolandSlider);
    expect(patternValue(rolandDataSet(90), rolandSlider)).toBe(90);
    expect(matchesPattern(rolandDataSet(90), rolandSlider)).toBe(true);
  });

  it("reads universal master volume from a device that leaves its fine byte at rest", () => {
    const pattern = learnPattern([
      [0x7f, 0x7f, 0x04, 0x01, 0x00, 0x20],
      [0x7f, 0x7f, 0x04, 0x01, 0x00, 0x21],
    ]);
    expect(
      pattern && patternValue([0x7f, 0x7f, 0x04, 0x01, 0x00, 99], pattern),
    ).toBe(99);
  });

  it("learns nothing from a message repeated unchanged", () => {
    expect(learnPattern([rolandDataSet(5), rolandDataSet(5)])).toBeNull();
  });

  it("learns nothing when a byte changes ahead of one that holds still", () => {
    expect(
      learnPattern([
        [0x43, 0x10, 0x4c, 0x10, 0x01, 0x0b, 0x78],
        [0x43, 0x10, 0x4c, 0x10, 0x02, 0x0b, 0x78],
      ]),
    ).toBeNull();
  });

  it("learns nothing from two unrelated messages", () => {
    expect(
      learnPattern([
        [0x43, 0x10, 0x4c, 0x10, 0x00, 0x0b, 0x78],
        [0x41, 0x10, 0x42, 0x12, 0x40, 0x00, 0x04],
      ]),
    ).toBeNull();
    expect(
      learnPattern([
        [0x43, 0x10],
        [0x43, 0x10, 0x4c],
      ]),
    ).toBeNull();
  });
});

describe("a learned SysEx pattern", () => {
  it("matches only messages of its own address and length", () => {
    expect(
      matchesPattern([0x43, 0x10, 0x4c, 0x10, 0x00, 0x0b, 5], genosSlider),
    ).toBe(true);
    expect(
      matchesPattern([0x43, 0x10, 0x4c, 0x10, 0x00, 0x0c, 5], genosSlider),
    ).toBe(false);
    expect(
      matchesPattern([0x43, 0x10, 0x4c, 0x10, 0x00, 0x0b], genosSlider),
    ).toBe(false);
  });

  it("names a slider by its address and a fixed button by all but its last byte", () => {
    expect(patternHeadLength(genosSlider)).toBe(6);
    expect(patternHeadLength([0x42, 0x30, 0x00, 0x7f])).toBe(3);
    expect(
      patternValue([0x42, 0x30, 0x00, 0x7f], [0x42, 0x30, 0x00, 0x7f]),
    ).toBeNull();
  });

  it("overlaps a button bound to one of its positions", () => {
    expect(
      patternsOverlap(genosSlider, [0x43, 0x10, 0x4c, 0x10, 0x00, 0x0b, 64]),
    ).toBe(true);
    expect(
      patternsOverlap(genosSlider, [0x43, 0x10, 0x4c, 0x10, 0x00, 0x0c, 64]),
    ).toBe(false);
  });
});
