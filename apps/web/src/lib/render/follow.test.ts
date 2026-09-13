import { describe, expect, it } from "vitest";
import type { Song, SongNote } from "@/lib/midi/song";
import { nextToPlay } from "@/lib/render/follow";

function note(partial: Partial<SongNote> & { id: number }): SongNote {
  return {
    pitch: 60,
    start: 0,
    end: 1,
    release: 1,
    velocity: 1,
    track: 0,
    ...partial,
  };
}

function songOf(notes: readonly SongNote[]): Song {
  return { notes, tracks: [], duration: 100 } as unknown as Song;
}

const none: ReadonlySet<number> = new Set();

describe("nextToPlay", () => {
  it("stays on the note still sounding rather than running ahead", () => {
    const song = songOf([
      note({ id: 1, pitch: 40, start: 0, release: 2 }),
      note({ id: 2, pitch: 80, start: 3, release: 4 }),
    ]);
    expect(nextToPlay(song, 1, none, null, 0)).toBe(40);
  });

  it("moves on once that note has let go", () => {
    const song = songOf([
      note({ id: 1, pitch: 40, start: 0, release: 2 }),
      note({ id: 2, pitch: 80, start: 3, release: 4 }),
    ]);
    expect(nextToPlay(song, 2.5, none, null, 0)).toBe(80);
  });

  it("looks past the accompaniment to the part that is the player's", () => {
    const song = songOf([
      note({ id: 1, pitch: 40, start: 1, release: 2 }),
      note({ id: 2, pitch: 80, start: 1, release: 2 }),
    ]);
    expect(nextToPlay(song, 0.5, none, new Set([2]), 0)).toBe(80);
  });

  it("ignores a track that is not on screen", () => {
    const song = songOf([
      note({ id: 1, pitch: 40, start: 1, release: 2, track: 3 }),
      note({ id: 2, pitch: 80, start: 1, release: 2, track: 0 }),
    ]);
    expect(nextToPlay(song, 0.5, new Set([3]), null, 0)).toBe(80);
  });

  it("holds the view still when the next note is far off", () => {
    const song = songOf([note({ id: 1, pitch: 40, start: 30, release: 31 })]);
    expect(nextToPlay(song, 0, none, null, 0)).toBeNull();
  });

  it("holds the view still once the song has run out", () => {
    const song = songOf([note({ id: 1, pitch: 40, start: 0, release: 1 })]);
    expect(nextToPlay(song, 50, none, null, 0)).toBeNull();
  });
});
