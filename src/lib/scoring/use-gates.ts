"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SongNote } from "@/lib/midi/song";
import { buildGates, type Gate, gateIndexAt } from "@/lib/scoring/gates";
import {
  applyJudgement,
  emptyScore,
  goodWindow,
  type Judgement,
  judge,
  type Score,
} from "@/lib/scoring/judge";

/** Bumped on every judged note so a flag re-triggers even when the verdict
 * repeats; the verdict alone would not change and the flag would sit still. */
export type Hit = { judgement: Judgement; seq: number };

export type Gates = {
  score: Score;
  waiting: boolean;
  lastHit: Hit | null;
  owed: () => ReadonlySet<number>;
  judgeStrike: (pitch: number, position: number) => void;
  /** How far each recent hit landed from the note it answered, in seconds. */
  timing: () => readonly number[];
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

/** Enough hits to read a habit from, and few enough that a player who fixes
 * their offset stops being told about the old one. */
const timedHitsKept = 24;

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
  const [lastHit, setLastHit] = useState<Hit | null>(null);
  const gatesRef = useRef<Gate[]>([]);
  const indexRef = useRef(0);
  const pendingRef = useRef<Set<number>>(new Set());
  /** How far each recent hit landed from the note it answered. */
  const timingRef = useRef<number[]>([]);
  const seqRef = useRef(0);

  const flag = useCallback((judgement: Judgement) => {
    seqRef.current += 1;
    setLastHit({ judgement, seq: seqRef.current });
  }, []);

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
        flag("miss");
        openAt(indexRef.current + 1);
      }
    }, 16);
    return () => clearInterval(timer);
  }, [active, waitsForYou, getPosition, isPlaying, pause, openAt, flag]);

  const judgeStrike = useCallback(
    (pitch: number, position: number) => {
      const gate = gatesRef.current[indexRef.current];
      if (gate === undefined) {
        return;
      }
      if (!pendingRef.current.has(pitch)) {
        setScore((current) => applyJudgement(current, "miss"));
        flag("miss");
        return;
      }
      pendingRef.current.delete(pitch);
      const delta = position - gate.start;
      // Kept so a player who is consistently behind can be told what their
      // offset should be. The device's own delay cannot be asked for.
      timingRef.current.push(delta);
      if (timingRef.current.length > timedHitsKept) {
        timingRef.current.shift();
      }
      const judgement = judge(delta);
      setScore((current) => applyJudgement(current, judgement));
      flag(judgement);
      if (pendingRef.current.size === 0) {
        const wasWaiting = waiting;
        openAt(indexRef.current + 1);
        if (wasWaiting) {
          resume();
        }
      }
    },
    [openAt, resume, waiting, flag],
  );

  return {
    score,
    waiting,
    lastHit,
    owed: useCallback(() => pendingRef.current as ReadonlySet<number>, []),
    judgeStrike,
    timing: useCallback(() => timingRef.current as readonly number[], []),
    moveTo: useCallback(
      (position: number) => openAt(gateIndexAt(gatesRef.current, position)),
      [openAt],
    ),
    reset: useCallback(() => {
      openAt(0);
      setScore(emptyScore);
      setLastHit(null);
      timingRef.current.length = 0;
    }, [openAt]),
  };
}
