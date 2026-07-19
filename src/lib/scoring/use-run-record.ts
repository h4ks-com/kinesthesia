"use client";

import { useEffect, useRef } from "react";
import type { MelodyRate } from "@/lib/midi/melody";
import type { PlayerMode, PlayerParams, Speed } from "@/lib/player-url";
import {
  accuracy,
  type Score,
  scorePoints,
  totalJudged,
} from "@/lib/scoring/judge";
import { scoreSubmission } from "@/lib/scoring/submission";

type Options = {
  mode: PlayerMode;
  params: PlayerParams;
  score: Score;
  elapsed: number;
  duration: number;
  active: boolean;
  speed: Speed;
  simplified: boolean;
  melodyRate: MelodyRate;
};

/** A run is worth recording once the song has run out and the player actually
 * played some of it. The server drops it when nobody is signed in. */
export function useRunRecord({
  mode,
  params,
  score,
  elapsed,
  duration,
  active,
  speed,
  simplified,
  melodyRate,
}: Options): void {
  const recorded = useRef<string | null>(null);
  const latest = useRef({ score, speed, simplified, melodyRate, params, mode });
  latest.current = { score, speed, simplified, melodyRate, params, mode };

  useEffect(() => {
    if (!active || duration <= 0 || elapsed < duration) {
      return;
    }
    const run = latest.current;
    if (recorded.current === run.params.url) {
      return;
    }
    // A match records its own result once it knows the opponent's score, so
    // only a solo learn run is posted here.
    if (totalJudged(run.score) === 0 || run.mode !== "learn") {
      return;
    }
    recorded.current = run.params.url;
    void fetch("/api/scores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        scoreSubmission(
          {
            name: run.params.name,
            url: run.params.url,
            speed: run.speed,
            simplified: run.simplified,
            melodyRate: run.melodyRate,
          },
          "learn",
          {
            points: scorePoints(run.score),
            accuracy: accuracy(run.score),
            bestCombo: run.score.bestCombo,
          },
        ),
      ),
    }).catch(() => {
      recorded.current = null;
    });
  }, [active, elapsed, duration]);
}
