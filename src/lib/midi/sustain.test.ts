import { describe, expect, it } from "vitest";
import { pedalSpans, releaseAt } from "@/lib/midi/sustain";

describe("pedalSpans", () => {
  it("pairs each press with the lift that follows it", () => {
    expect(
      pedalSpans(
        [
          { time: 1, value: 1 },
          { time: 2, value: 0 },
          { time: 4, value: 1 },
          { time: 5, value: 0 },
        ],
        10,
      ),
    ).toEqual([
      { start: 1, end: 2 },
      { start: 4, end: 5 },
    ]);
  });

  it("ignores a press repeated while the pedal is already down", () => {
    expect(
      pedalSpans(
        [
          { time: 1, value: 1 },
          { time: 2, value: 0.9 },
          { time: 3, value: 0 },
        ],
        10,
      ),
    ).toEqual([{ start: 1, end: 3 }]);
  });

  it("reads half travel as down, matching a hardware pedal", () => {
    expect(pedalSpans([{ time: 1, value: 0.4 }], 10)).toEqual([]);
    expect(pedalSpans([{ time: 1, value: 0.5 }], 10)).toEqual([
      { start: 1, end: 10 },
    ]);
  });

  it("holds a pedal still down at the end of the file to the last note", () => {
    expect(pedalSpans([{ time: 2, value: 1 }], 9)).toEqual([
      { start: 2, end: 9 },
    ]);
  });
});

describe("releaseAt", () => {
  const spans = [
    { start: 1, end: 3 },
    { start: 6, end: 8 },
  ];

  it("holds a note that ends under the pedal until the lift", () => {
    expect(releaseAt(2, spans)).toBe(3);
  });

  it("leaves a note that ends with the pedal up alone", () => {
    expect(releaseAt(4, spans)).toBe(4);
  });

  it("leaves a note that outlasts the lift alone", () => {
    expect(releaseAt(3.5, spans)).toBe(3.5);
  });

  it("leaves a note alone when no pedal was ever pressed", () => {
    expect(releaseAt(2, [])).toBe(2);
  });
});

describe("carry limit", () => {
  it("stops a note ringing far past what a string would hold", () => {
    // A pedal pressed and never lifted spans the rest of the file. Carrying a
    // note that far keeps its voice and its key alive for minutes.
    const spans = pedalSpans([{ time: 1, value: 1 }], 300);
    expect(releaseAt(2, spans)).toBeLessThan(30);
  });

  it("still carries an ordinary pedalled note to the lift", () => {
    const spans = pedalSpans(
      [
        { time: 1, value: 1 },
        { time: 4, value: 0 },
      ],
      300,
    );
    expect(releaseAt(2, spans)).toBe(4);
  });
});
