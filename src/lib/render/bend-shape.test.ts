import { describe, expect, it } from "vitest";
import { ExpressionTrail } from "@/lib/midi/expression";
import {
  type BendRow,
  bentRows,
  maxBendSteps,
  momentAt,
  type NoteBar,
  type TimeAtHeight,
} from "@/lib/render/bend-shape";

/** A bar 300 tall, the shape a held note takes on screen. */
const bar: NoteBar = { top: 0, height: 300 };
const whiteWidth = 20;

const falling: TimeAtHeight = (y) => 3 - y / 100;
const rising: TimeAtHeight = (y) => y / 100;

/** The roll's own numbers: the keys at 400, and 100 pixels to the second. */
const keyboardTop = 400;
const scale = 100;

function wheelAt(track: number, at: number, bend: number): ExpressionTrail {
  const trail = new ExpressionTrail({ keepAll: true });
  trail.setBend(track, at, bend);
  return trail;
}

function offsets(rows: readonly BendRow[] | null): number[] {
  return (rows ?? []).map((row) => row.offset);
}

describe("reading a height as a moment", () => {
  it("puts the strike line at the playhead, whichever way notes travel", () => {
    expect(momentAt(9, keyboardTop, scale, false)(keyboardTop)).toBeCloseTo(9);
    expect(momentAt(9, keyboardTop, scale, true)(keyboardTop)).toBeCloseTo(9);
  });

  it("reads height as the future for a note falling toward the keys", () => {
    // Two seconds up the roll is two seconds before the note lands.
    expect(
      momentAt(9, keyboardTop, scale, false)(keyboardTop - 200),
    ).toBeCloseTo(11);
  });

  it("reads height as the past for a note climbing away from them", () => {
    // The same height is two seconds after the note left the keys.
    expect(
      momentAt(9, keyboardTop, scale, true)(keyboardTop - 200),
    ).toBeCloseTo(7);
  });
});

describe("laying a note along the wheels", () => {
  it("leaves a bar the wheels sat still through unshaped", () => {
    expect(
      bentRows(new ExpressionTrail(), 0, falling, bar, whiteWidth),
    ).toBeNull();
  });

  it("leaves a bar alone when the wheel moved on another channel", () => {
    expect(bentRows(wheelAt(1, 0, 1), 0, falling, bar, whiteWidth)).toBeNull();
  });

  it("throws the note one way for a bend up", () => {
    const rows = bentRows(wheelAt(0, 0, 1), 0, falling, bar, whiteWidth);

    expect(rows).not.toBeNull();
    expect(Math.min(...offsets(rows))).toBeGreaterThan(0);
  });

  it("throws it the other way for a bend down", () => {
    const rows = bentRows(wheelAt(0, 0, -1), 0, falling, bar, whiteWidth);

    expect(rows).not.toBeNull();
    expect(Math.max(...offsets(rows))).toBeLessThan(0);
  });

  it("shapes only the stretch the wheel had already moved under", () => {
    // The wheel moves at 1.5s, halfway along a bar covering 0s to 3s.
    const rows = bentRows(wheelAt(0, 1.5, 1), 0, falling, bar, whiteWidth);
    const shaped = (rows ?? []).filter((row) => row.offset !== 0);
    const flat = (rows ?? []).filter((row) => row.offset === 0);

    expect(shaped.length).toBeGreaterThan(0);
    expect(flat.length).toBeGreaterThan(0);
    // Falling, the top of the bar is the later moment, so the bend is up there
    // and the stretch played before the wheel moved stays straight below it.
    expect(Math.max(...shaped.map((row) => row.y))).toBeLessThanOrEqual(
      Math.min(...flat.map((row) => row.y)),
    );
  });

  it("reads a rising note as the mirror of a falling one", () => {
    const bentEnd = (timeAt: TimeAtHeight): number[] =>
      (bentRows(wheelAt(0, 1.5, 1), 0, timeAt, bar, whiteWidth) ?? [])
        .filter((row) => row.offset !== 0)
        .map((row) => row.y);

    expect(Math.max(...bentEnd(falling))).toBeLessThanOrEqual(bar.height / 2);
    expect(Math.min(...bentEnd(rising))).toBeGreaterThanOrEqual(bar.height / 2);
  });
});

describe("keeping the trace rigid", () => {
  it("samples the same moments as the bar grows", () => {
    const trail = wheelAt(0, 0, 1);
    const short = bentRows(trail, 0, falling, bar, whiteWidth) ?? [];
    const grown =
      bentRows(trail, 0, falling, { ...bar, height: 320 }, whiteWidth) ?? [];

    // Read back through the mapping, since the two bars place the same moment
    // at different heights and the rows cannot be compared as they stand.
    const sampledMoments = (rows: readonly BendRow[]): number[] =>
      rows.slice(1, -1).map((row) => Number(falling(row.y).toFixed(6)));

    expect(sampledMoments(grown)).toEqual(
      expect.arrayContaining(sampledMoments(short)),
    );
  });

  it("never draws more steps than the cap, however long the note", () => {
    const long = { ...bar, height: 300_000 };

    expect(
      (bentRows(wheelAt(0, 0, 1), 0, falling, long, whiteWidth) ?? []).length,
    ).toBeLessThanOrEqual(maxBendSteps + 1);
  });

  it("gives a note with no height a single row", () => {
    const flat = { ...bar, height: 0 };

    expect(
      bentRows(wheelAt(0, 0, 1), 0, falling, flat, whiteWidth),
    ).toHaveLength(1);
  });
});
