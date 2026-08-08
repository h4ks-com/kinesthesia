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

  describe("spread", () => {
    it("is nothing before a note is struck", () => {
      const { view } = bench([note(60, 1)], false);
      expect(view.result.current.summary(99).spread).toBe(0);
    });

    it("ignores which side of the beat a strike fell", () => {
      const { view, settle } = bench([note(60, 1), note(62, 2, 62)], false);
      settle(1);
      act(() => {
        view.result.current.judgeStrike(60, 1.04);
      });
      settle(2);
      act(() => {
        view.result.current.judgeStrike(62, 1.96);
      });
      expect(view.result.current.summary(99).spread).toBeCloseTo(0.04, 6);
    });

    // The rank is read off this, so it has to describe the whole run rather
    // than the tail of it: a clean song flubbed at the end must not rank as a
    // flubbed one.
    it("keeps counting past the window the latency hint remembers", () => {
      const many = Array.from({ length: 40 }, (_, index) =>
        note(60 + (index % 12), index + 1, index),
      );
      const { view, settle } = bench(many, false);
      // Tidy for most of the song, then scrappy over the closing notes, so the
      // tail the latency hint keeps and the whole run disagree.
      for (let index = 0; index < 40; index += 1) {
        settle(index + 1);
        act(() => {
          view.result.current.judgeStrike(
            60 + (index % 12),
            index + 1 + (index < 30 ? 0.01 : 0.2),
          );
        });
      }
      expect(view.result.current.timing()).toHaveLength(24);
      const whole = (30 * 0.01 + 10 * 0.2) / 40;
      const tail = (14 * 0.01 + 10 * 0.2) / 24;
      expect(view.result.current.summary(99).spread).toBeCloseTo(whole, 6);
      expect(view.result.current.summary(99).spread).not.toBeCloseTo(tail, 3);
    });

    // A gate opens as soon as the one before it is answered, so a player can
    // strike the next note a bar early. Unbounded, one guess would drag the
    // whole run's timing with it.
    it("holds an anticipated note to the same reach as a late one", () => {
      const { view, settle } = bench([note(60, 1), note(62, 9, 62)], false);
      settle(1);
      act(() => {
        view.result.current.judgeStrike(60, 1);
      });
      act(() => {
        view.result.current.judgeStrike(62, 2);
      });
      expect(view.result.current.summary(20).spread).toBeLessThanOrEqual(
        lateWindow,
      );
    });

    it("forgets the run when the score is reset", () => {
      const { view, settle } = bench([note(60, 1)], false);
      settle(1);
      act(() => {
        view.result.current.judgeStrike(60, 1.1);
      });
      expect(view.result.current.summary(99).spread).toBeGreaterThan(0);
      act(() => {
        view.result.current.reset();
      });
      expect(view.result.current.summary(99).spread).toBe(0);
    });
  });

  describe("holding", () => {
    it("pays for a note kept down past where holding starts", () => {
      const { view, settle } = bench([note(60, 1, 60, 2)], false);
      settle(1);
      act(() => {
        view.result.current.judgeStrike(60, 1);
      });
      act(() => {
        view.result.current.judgeRelease(60, 2.5);
      });
      expect(view.result.current.bonus).toBeGreaterThan(0);
    });

    // The bug the model replaces: a player who never touched a key was handed
    // a full hold score.
    it("pays nothing to a player who struck nothing", () => {
      const { view, settle } = bench([note(60, 1, 60, 3)], false);
      settle(1);
      expect(view.result.current.summary(9).points).toBe(0);
    });

    it("pays nothing for a note let go at once", () => {
      const { view, settle } = bench([note(60, 1, 60, 3)], false);
      settle(1);
      act(() => {
        view.result.current.judgeStrike(60, 1);
      });
      act(() => {
        view.result.current.judgeRelease(60, 1.05);
      });
      expect(view.result.current.bonus).toBe(0);
    });

    it("pays more the longer a note is kept down", () => {
      const brief = bench([note(60, 1, 60, 4)], false);
      brief.settle(1);
      act(() => {
        brief.view.result.current.judgeStrike(60, 1);
      });
      act(() => {
        brief.view.result.current.judgeRelease(60, 1.6);
      });

      const long = bench([note(60, 1, 60, 4)], false);
      long.settle(1);
      act(() => {
        long.view.result.current.judgeStrike(60, 1);
      });
      act(() => {
        long.view.result.current.judgeRelease(60, 4);
      });
      expect(long.view.result.current.bonus).toBeGreaterThan(
        brief.view.result.current.bonus,
      );
    });

    it("keeps the bonus inside the score the card reads out", () => {
      const { view, settle } = bench([note(60, 1, 60, 3)], false);
      settle(1);
      act(() => {
        view.result.current.judgeStrike(60, 1);
      });
      act(() => {
        view.result.current.judgeRelease(60, 4);
      });
      const bare = view.result.current.summary(9).points;
      expect(bare).toBeGreaterThan(view.result.current.bonus);
    });

    it("pays for a note still down when the run ends", () => {
      const { view, settle } = bench([note(60, 1, 60, 3)], false);
      settle(1);
      act(() => {
        view.result.current.judgeStrike(60, 1);
      });
      expect(view.result.current.summary(4).points).toBeGreaterThan(
        view.result.current.summary(1.1).points,
      );
    });

    it("passes over a key coming up that nothing was holding", () => {
      const { view, settle } = bench([note(60, 1, 60, 2)], false);
      settle(1);
      act(() => {
        view.result.current.judgeRelease(64, 2);
      });
      expect(view.result.current.bonus).toBe(0);
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
      expect(view.result.current.bonus).toBe(0);
    });
  });
});
