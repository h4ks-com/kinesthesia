import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpponentPanel } from "@/components/opponent-panel";
import { ExpressionTrail } from "@/lib/midi/expression";
import type { Song, SongNote } from "@/lib/midi/song";
import { noOpponent } from "@/lib/multiplayer/protocol";
import { emptyScore } from "@/lib/scoring/judge";

/** The roll is a canvas, which jsdom cannot draw, so it is stood in for and the
 * getters it would have drawn from are read instead. */
const drawnWith: { getPressed: (() => ReadonlySet<number>) | null } = {
  getPressed: null,
};
vi.mock("@/components/piano-roll-view", () => ({
  PianoRollView: (props: { getPressed: () => ReadonlySet<number> }) => {
    drawnWith.getPressed = props.getPressed;
    return null;
  },
}));

// The panel reads the plain-style setting on mount, and jsdom keeps no
// database to read it from.
vi.mock("@/lib/storage/settings", () => ({
  loadGlobalSettings: () => Promise.resolve(null),
}));

function note(pitch: number, start: number): SongNote {
  return {
    id: pitch + start * 100,
    pitch,
    start,
    end: start + 0.5,
    release: start + 0.5,
    velocity: 1,
    track: 0,
  };
}

const song: Song = {
  name: "Test",
  duration: 8,
  tracks: [
    {
      index: 0,
      name: "Piano",
      instrument: "acoustic grand piano",
      program: 0,
      percussion: false,
      noteCount: 4,
    },
  ],
  notes: [note(60, 0), note(62, 1), note(64, 2), note(65, 3)],
  expression: new ExpressionTrail(),
  harmony: [],
  key: null,
  hands: new Map(),
};

const part = {
  simplified: false,
  melodyRate: 8,
  tracks: [0],
  hand: null,
} as const;

function show(theirKeys: () => ReadonlySet<number>) {
  return render(
    <OpponentPanel
      song={song}
      part={part}
      onPart={null}
      coop={false}
      onCoop={null}
      locked
      opponent={{ ...noOpponent, points: 400, score: emptyScore }}
      getPosition={() => 1.1}
      theirKeys={theirKeys}
      hit={null}
      state="playing"
    />,
  );
}

describe("OpponentPanel", () => {
  beforeEach(() => {
    drawnWith.getPressed = null;
  });

  // Their piano is on screen to show what they are doing. Drawing the song's
  // own notes there would light keys nobody touched.
  it("presses the keys they are holding, not the ones the song is sounding", () => {
    show(() => new Set([70, 71]));
    expect([...(drawnWith.getPressed?.() ?? [])]).toEqual([70, 71]);
  });

  it("reads their keys every time it draws, so a release shows", () => {
    let held: ReadonlySet<number> = new Set([60]);
    show(() => held);
    expect(drawnWith.getPressed?.().has(60)).toBe(true);
    held = new Set();
    expect(drawnWith.getPressed?.().size).toBe(0);
  });

  it("holds no key down while their hands are off the keyboard", () => {
    show(() => new Set());
    expect(drawnWith.getPressed?.().size).toBe(0);
  });
});
