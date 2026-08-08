import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SongNote } from "@/lib/midi/song";
import { lateWindow } from "@/lib/scoring/judge";
import { useGates } from "@/lib/scoring/use-gates";

function note(pitch: number, start: number, id = pitch, length = 1): SongNote {
  return {
    id,
    pitch,
    start,
    end: start + length,
    release: start + length,
    velocity: 0.8,
    track: 0,
  };
}

/** A clock and transport the test drives by hand, read live through the hook. */
function bench(owed: readonly SongNote[], waitsForYou: boolean) {
  const now = { value: 0 };
  const playing = { value: true };
  const pause = vi.fn(() => {
    playing.value = false;
  });
  const resume = vi.fn(() => {
    playing.value = true;
  });
  // Held still across renders: the hook rebuilds its gates whenever these
  // change, and a fresh one each render would keep wiping the score.
  const getPosition = () => now.value;
  const isPlaying = () => playing.value;
  const view = renderHook(() =>
    useGates({
      owed,
      active: true,
      waitsForYou,
      getPosition,
      isPlaying,
      pause,
      resume,
    }),
  );
  // The gate loop polls, so time only moves when the test says it does.
  const settle = (to: number) => {
    now.value = to;
    act(() => {
      vi.advanceTimersByTime(32);
    });
  };
  return { view, pause, resume, settle };
}

describe("useGates", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("carries the song on through a note played a little late", () => {
    const { view, settle, pause } = bench([note(60, 1)], true);

    settle(1 + lateWindow - 0.01);
    expect(pause).not.toHaveBeenCalled();
    expect(view.result.current.waiting).toBe(false);
  });

  it("stops for a note only once it has gone by", () => {
    const { view, settle, pause } = bench([note(60, 1)], true);

    settle(1 + lateWindow - 0.01);
    expect(pause).not.toHaveBeenCalled();

    settle(1 + lateWindow + 0.02);
    expect(pause).toHaveBeenCalled();
    expect(view.result.current.waiting).toBe(true);
  });

  it("scores a late press by how late it was, and keeps playing", () => {
    const { view, settle, pause } = bench([note(60, 1)], true);

    settle(1.1);
    act(() => {
      view.result.current.judgeStrike(60, 1.1);
    });
    expect(view.result.current.score.good).toBe(1);
    expect(pause).not.toHaveBeenCalled();
  });

  it("carries the song on again once a note it stopped for is played", () => {
    const { view, settle, resume } = bench([note(60, 1)], true);

    settle(1 + lateWindow + 0.02);
    act(() => {
      view.result.current.judgeStrike(60, 1 + lateWindow + 0.02);
    });
    expect(resume).toHaveBeenCalled();
    // The wait is the song's delay, so it is no part of the player's habit.
    expect(view.result.current.timing()).toHaveLength(0);
  });

  // Nearer the note is a better grade in both directions, so no amount of
  // waiting can score better than playing it closer to the beat.
  it("grades by how near the note was struck, early or late alike", () => {
    for (const [away, expected] of [
      [0, "perfect"],
      [-0.03, "perfect"],
      [0.1, "good"],
      [-0.1, "good"],
      [0.25, "missed"],
    ] as const) {
      const { view, settle } = bench([note(60, 1)], true);
      settle(1);
      act(() => {
        view.result.current.judgeStrike(60, 1 + away);
      });
      expect(view.result.current.score[expected]).toBe(1);
    }
  });

  it("never stops the song in a match, and writes the note off at the same bound", () => {
    const { view, settle, pause } = bench([note(60, 1)], false);

    settle(1 + lateWindow - 0.01);
    expect(view.result.current.score.missed).toBe(0);

    settle(1 + lateWindow + 0.02);
    expect(view.result.current.score.missed).toBe(1);
    expect(pause).not.toHaveBeenCalled();
  });

  it("never waits past the note that follows, however close it is", () => {
    const { view, settle, pause } = bench(
      [note(60, 1), note(62, 1.2, 62)],
      true,
    );

    settle(1.19);
    expect(pause).not.toHaveBeenCalled();

    settle(1.21);
    expect(pause).toHaveBeenCalled();
    act(() => {
      view.result.current.judgeStrike(60, 1.21);
    });
    // The gate that follows is still ahead, so it can be played in time.
    expect(view.result.current.owed().has(62)).toBe(true);
  });

  it("closes a match's gate before the next one, so a note on time is not judged against it", () => {
    const { view, settle } = bench([note(60, 1), note(62, 1.2, 62)], false);

    // Still inside the first gate's own late window, and already retired: the
    // next gate arriving is what closes it.
    settle(1.19);
    expect(view.result.current.score.missed).toBe(0);

    settle(1.21);
    expect(view.result.current.score.missed).toBe(1);
    act(() => {
      view.result.current.judgeStrike(62, 1.21);
    });
    expect(view.result.current.score.missed).toBe(1);
    expect(view.result.current.score.perfect).toBe(1);
  });

  it("holds a chord open until every note of it is played", () => {
    const { view, settle, pause } = bench([note(60, 1), note(64, 1, 64)], true);

    settle(1.05);
    act(() => {
      view.result.current.judgeStrike(60, 1.05);
    });
    expect(view.result.current.owed().has(64)).toBe(true);
    expect(pause).not.toHaveBeenCalled();

    act(() => {
      view.result.current.judgeStrike(64, 1.06);
    });
    expect(view.result.current.owed().size).toBe(0);
  });

  describe("holding", () => {
    it("counts a long note the player saw out", () => {
      const { view, settle } = bench([note(60, 1, 60, 2)], false);
      settle(1);
      act(() => {
        view.result.current.judgeStrike(60, 1);
      });
      act(() => {
        view.result.current.judgeRelease(60, 3);
      });
      expect(view.result.current.holds).toEqual({ kept: 1, letGo: 0 });
    });

    it("calls out one dropped well before its end", () => {
      const { view, settle } = bench([note(60, 1, 60, 2)], false);
      settle(1);
      act(() => {
        view.result.current.judgeStrike(60, 1);
      });
      act(() => {
        view.result.current.judgeRelease(60, 1.4);
      });
      expect(view.result.current.holds).toEqual({ kept: 0, letGo: 1 });
      expect(view.result.current.lastHit?.judgement).toBe("letGo");
    });

    // The whole point: today letting go at once scores the same as holding.
    it("asks nothing of a note too short to hold", () => {
      const { view, settle } = bench([note(60, 1, 60, 0.2)], false);
      settle(1);
      act(() => {
        view.result.current.judgeStrike(60, 1);
      });
      act(() => {
        view.result.current.judgeRelease(60, 1.01);
      });
      expect(view.result.current.holds).toEqual({ kept: 0, letGo: 0 });
    });

    it("passes over a key coming up that nothing was holding", () => {
      const { view, settle } = bench([note(60, 1, 60, 2)], false);
      settle(1);
      act(() => {
        view.result.current.judgeRelease(64, 2);
      });
      expect(view.result.current.holds).toEqual({ kept: 0, letGo: 0 });
    });

    it("forgets what was being held when the song is moved", () => {
      const { view, settle } = bench([note(60, 1, 60, 2)], false);
      settle(1);
      act(() => {
        view.result.current.judgeStrike(60, 1);
      });
      act(() => {
        view.result.current.moveTo(40);
      });
      act(() => {
        view.result.current.judgeRelease(60, 41);
      });
      expect(view.result.current.holds).toEqual({ kept: 0, letGo: 0 });
    });

    it("forgets what was being held when the score is reset", () => {
      const { view, settle } = bench([note(60, 1, 60, 2)], false);
      settle(1);
      act(() => {
        view.result.current.judgeStrike(60, 1);
      });
      act(() => {
        view.result.current.reset();
      });
      act(() => {
        view.result.current.judgeRelease(60, 1.2);
      });
      expect(view.result.current.holds).toEqual({ kept: 0, letGo: 0 });
    });
  });
});
