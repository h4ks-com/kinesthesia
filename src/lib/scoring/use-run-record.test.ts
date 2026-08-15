import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultMelodyRate } from "@/lib/midi/melody";
import type { PlayerParams } from "@/lib/player-url";
import { emptyScore, type Score } from "@/lib/scoring/judge";
import type { Summary } from "@/lib/scoring/summary";
import { useRunRecord } from "@/lib/scoring/use-run-record";

const params: PlayerParams = {
  url: "https://example.test/song.mid",
  name: "Song",
  source: "url",
  tracks: null,
  speed: 1,
  simplified: false,
  melodyRate: defaultMelodyRate,
  hand: null,
  transpose: 0,
  focus: false,
  skin: null,
  rise: false,
  start: 0,
};

const score: Score = { ...emptyScore, perfect: 4, bestCombo: 4 };

/** What the run was worth, read at the moment the song ran out. Points and
 * accuracy differ so a submission built from the wrong one is visible. */
function summary(at: number): Summary {
  return {
    points: at === 0 ? 0 : 917,
    notes: 1,
    streak: 4,
    accuracy: 0.83,
    spread: 0.02,
    shape: [],
  };
}

function posted(): Record<string, unknown> {
  const call = vi.mocked(fetch).mock.calls[0];
  return JSON.parse(String(call?.[1]?.body));
}

describe("useRunRecord", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response())),
    );
  });

  function play(overrides: Partial<Parameters<typeof useRunRecord>[0]> = {}) {
    return renderHook(() =>
      useRunRecord({
        mode: "learn",
        params,
        score,
        summary,
        elapsed: 60,
        duration: 60,
        active: true,
        speed: 1,
        simplified: false,
        melodyRate: defaultMelodyRate,
        ...overrides,
      }),
    );
  }

  // The card and the leaderboard read one number, so a hold bonus that shows on
  // one and not the other would rank the same playing two ways.
  it("records the run at the same worth the card reads out", () => {
    play();
    expect(posted().points).toBe(summary(60).points);
    expect(posted().accuracy).toBe(summary(60).accuracy);
  });

  it("settles the run against where the song ended", () => {
    const at = vi.fn(summary);
    play({ summary: at });
    expect(at).toHaveBeenCalledWith(60);
  });

  it("records nothing while the song is still running", () => {
    play({ elapsed: 30 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("records nothing for a run nobody played", () => {
    play({ score: emptyScore });
    expect(fetch).not.toHaveBeenCalled();
  });

  // A match records its own result once it knows the opponent's score.
  it("leaves a match to record itself", () => {
    play({ mode: "multiplayer" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
