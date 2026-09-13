import { describe, expect, it } from "vitest";
import { defaultVoicing, type SongVoicing } from "@/lib/audio/voicing";
import { trackColor } from "@/lib/midi/palette";
import type { SongNote } from "@/lib/midi/song";
import { drawSongMap, type MappedSong, pitchSpan } from "@/lib/render/minimap";

const noVoicing: SongVoicing = new Map();

const quiet = defaultVoicing({
  index: 1,
  name: "one",
  instrument: "Acoustic grand piano",
  program: 0,
  percussion: false,
  noteCount: 1,
});

let next = 0;

function note(pitch: number, start: number, end: number, track = 0): SongNote {
  next += 1;
  return { id: next, pitch, start, end, release: end, velocity: 100, track };
}

function songOf(notes: readonly SongNote[], duration = 10): MappedSong {
  return { duration, notes };
}

type Painted = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly fill: string;
  readonly alpha: number;
};

function recorder(): {
  ctx: CanvasRenderingContext2D;
  painted: Painted[];
} {
  const painted: Painted[] = [];
  const state = { fillStyle: "", globalAlpha: 1 };
  const ctx = {
    get fillStyle(): string {
      return state.fillStyle;
    },
    set fillStyle(value: string) {
      state.fillStyle = value;
    },
    get globalAlpha(): number {
      return state.globalAlpha;
    },
    set globalAlpha(value: number) {
      state.globalAlpha = value;
    },
    clearRect: () => {},
    fillRect: (x: number, y: number, width: number, height: number) => {
      painted.push({
        x,
        y,
        width,
        height,
        fill: state.fillStyle,
        alpha: state.globalAlpha,
      });
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, painted };
}

describe("pitchSpan", () => {
  it("is the range the song actually uses, so the height is spent on it", () => {
    expect(pitchSpan(songOf([note(60, 0, 1), note(72, 1, 2)]))).toEqual({
      low: 60,
      high: 72,
    });
  });

  // A map of a song with no notes still has to be drawable rather than divide
  // by an empty range.
  it("falls back to a middle octave for a song with nothing in it", () => {
    expect(pitchSpan(songOf([]))).toEqual({ low: 48, high: 72 });
  });
});

describe("drawSongMap", () => {
  const wide = { width: 200, height: 40 };

  it("puts a note where its time and pitch say, across the whole width", () => {
    const { ctx, painted } = recorder();
    const song = songOf([note(60, 0, 1), note(72, 9, 10)]);

    drawSongMap(ctx, {
      ...wide,
      song,
      span: pitchSpan(song),
      hiddenTracks: new Set(),
      voicing: noVoicing,
      lit: true,
    });

    const [low, high] = painted;
    expect(low?.x).toBe(0);
    expect(high?.x).toBeCloseTo(180, 5);
    // The higher note is drawn nearer the top.
    expect(high?.y ?? 0).toBeLessThan(low?.y ?? 0);
  });

  it("leaves out a track nobody is shown", () => {
    const { ctx, painted } = recorder();
    const song = songOf([note(60, 0, 1, 0), note(64, 0, 1, 1)]);

    drawSongMap(ctx, {
      ...wide,
      song,
      span: pitchSpan(song),
      hiddenTracks: new Set([1]),
      voicing: noVoicing,
      lit: true,
    });

    expect(painted).toHaveLength(1);
  });

  // A part that never leaves an octave would be a row of dots at true scale, so
  // a note is never drawn thinner than it can be seen.
  it("keeps a note visible however narrow the song's range is", () => {
    const { ctx, painted } = recorder();
    const song = songOf([note(60, 0, 1), note(61, 1, 2)]);

    drawSongMap(ctx, {
      ...wide,
      song,
      span: pitchSpan(song),
      hiddenTracks: new Set(),
      voicing: noVoicing,
      lit: true,
    });

    for (const mark of painted) {
      expect(mark.height).toBeGreaterThanOrEqual(1.5);
      expect(mark.width).toBeGreaterThanOrEqual(1);
    }
  });

  // A note that starts later covers one already sounding, so the only way a
  // part stays readable under a busier one is to be painted after it.
  it("paints a track asked to the front after every other track", () => {
    const song = songOf([note(60, 0, 4, 0), note(64, 1, 2, 1)]);
    const { ctx, painted } = recorder();
    const front = new Map([[1, { ...quiet, front: true }]]);

    drawSongMap(ctx, {
      ...wide,
      song,
      span: pitchSpan(song),
      hiddenTracks: new Set<number>(),
      voicing: front,
      lit: true,
    });

    expect(painted.map((mark) => mark.fill)).toEqual([
      trackColor(0, front).glow,
      trackColor(1, front).glow,
    ]);
  });

  it("leaves the order alone where nobody has asked to be in front", () => {
    // Track 1 sounds first, so start order alone puts it first.
    const song = songOf([note(64, 0, 2, 1), note(60, 1, 4, 0)]);
    const { ctx, painted } = recorder();

    drawSongMap(ctx, {
      ...wide,
      song,
      span: pitchSpan(song),
      hiddenTracks: new Set<number>(),
      voicing: noVoicing,
      lit: true,
    });

    expect(painted.map((mark) => mark.fill)).toEqual([
      trackColor(1, noVoicing).glow,
      trackColor(0, noVoicing).glow,
    ]);
  });

  // The played and unplayed passes are the same picture at two strengths, which
  // is what lets the playhead reveal one over the other instead of redrawing.
  it("draws the unplayed pass weaker than the played one", () => {
    const song = songOf([note(60, 0, 1)]);
    const shared = {
      ...wide,
      song,
      span: pitchSpan(song),
      hiddenTracks: new Set<number>(),
      voicing: noVoicing,
    };
    const dim = recorder();
    const lit = recorder();

    drawSongMap(dim.ctx, { ...shared, lit: false });
    drawSongMap(lit.ctx, { ...shared, lit: true });

    expect(dim.painted[0]?.alpha ?? 1).toBeLessThan(lit.painted[0]?.alpha ?? 0);
    expect(dim.painted[0]?.x).toBe(lit.painted[0]?.x);
    expect(dim.painted[0]?.y).toBe(lit.painted[0]?.y);
  });
});
