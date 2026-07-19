"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SongNote } from "@/lib/midi/song";
import { buildGates, type Gate, gateIndexAt } from "@/lib/scoring/gates";
import {
  applyJudgement,
  emptyScore,
  goodWindow,
  judge,
  type Score,
} from "@/lib/scoring/judge";

export type Gates = {
  score: Score;
  waiting: boolean;
  owed: () => ReadonlySet<number>;
  judgeStrike: (pitch: number, position: number) => void;
  moveTo: (position: number) => void;
  reset: () => void;
};

type Options = {
  owed: readonly SongNote[];
  active: boolean;
  waitsForYou: boolean;
  getPosition: () => number;
  isPlaying: () => boolean;
  pause: () => void;
  resume: () => void;
};

export function useGates({
  owed,
  active,
  waitsForYou,
  getPosition,
  isPlaying,
  pause,
  resume,
}: Options): Gates {
  const [score, setScore] = useState<Score>(emptyScore);
  const [waiting, setWaiting] = useState(false);
  const gatesRef = useRef<Gate[]>([]);
  const indexRef = useRef(0);
  const pendingRef = useRef<Set<number>>(new Set());

  const openAt = useCallback((index: number) => {
    indexRef.current = index;
    pendingRef.current = new Set(gatesRef.current[index]?.pitches ?? []);
    setWaiting(false);
  }, []);

  useEffect(() => {
    if (!active) {
      gatesRef.current = [];
      return;
    }
    gatesRef.current = buildGates(owed);
    // Changing what you owe part way through must not drag the gate back to
    // the first note while the song plays on without it.
    openAt(gateIndexAt(gatesRef.current, getPosition()));
    setScore(emptyScore);
  }, [owed, active, openAt, getPosition]);

  useEffect(() => {
    if (!active) {
      return;
    }
    const timer = setInterval(() => {
      const gate = gatesRef.current[indexRef.current];
      if (gate === undefined || !isPlaying()) {
        return;
      }
      const position = getPosition();
      if (position < gate.start || pendingRef.current.size === 0) {
        return;
      }
      if (waitsForYou) {
        pause();
        setWaiting(true);
        return;
      }
      // The band never stops in a battle, so an unplayed note is simply missed.
      if (position > gate.start + goodWindow) {
        const missed = pendingRef.current.size;
        setScore((current) => {
          let next = current;
          for (let count = 0; count < missed; count += 1) {
            next = applyJudgement(next, "miss");
          }
          return next;
        });
        openAt(indexRef.current + 1);
      }
    }, 16);
    return () => clearInterval(timer);
  }, [active, waitsForYou, getPosition, isPlaying, pause, openAt]);

  const judgeStrike = useCallback(
    (pitch: number, position: number) => {
      const gate = gatesRef.current[indexRef.current];
      if (gate === undefined) {
        return;
      }
      if (!pendingRef.current.has(pitch)) {
        setScore((current) => applyJudgement(current, "miss"));
        return;
      }
      pendingRef.current.delete(pitch);
      setScore((current) =>
        applyJudgement(current, judge(position - gate.start)),
      );
      if (pendingRef.current.size === 0) {
        const wasWaiting = waiting;
        openAt(indexRef.current + 1);
        if (wasWaiting) {
          resume();
        }
      }
    },
    [openAt, resume, waiting],
  );

  return {
    score,
    waiting,
    owed: useCallback(() => pendingRef.current as ReadonlySet<number>, []),
    judgeStrike,
    moveTo: useCallback(
      (position: number) => openAt(gateIndexAt(gatesRef.current, position)),
      [openAt],
    ),
    reset: useCallback(() => {
      openAt(0);
      setScore(emptyScore);
    }, [openAt]),
  };
}
