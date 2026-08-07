"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SongNote } from "@/lib/midi/song";
import {
  buildGates,
  type Gate,
  gateDeadline,
  gateIndexAt,
} from "@/lib/scoring/gates";
import {
  applyJudgement,
  emptyScore,
  type Judgement,
  judge,
  type Score,
} from "@/lib/scoring/judge";

/** Bumped on every judged note so a flag re-triggers even when the verdict
 * repeats; the verdict alone would not change and the flag would sit still.
 * `away` is how far from the beat the strike landed, negative early, and null
 * where there was no beat to measure against: a note struck that nothing asked
 * for, or one nobody struck at all. */
export type Hit = { judgement: Judgement; away: number | null; seq: number };

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
  /** Whether the song is stopped for this gate. Held beside the state because a
   * strike arriving between the pause and the render that carries it would
   * otherwise read as a hit made while playing, and the resume that ends the
   * wait would never be called. */
  const waitingRef = useRef(false);
  /** How far each recent hit landed from the note it answered. */
  const timingRef = useRef<number[]>([]);
  const seqRef = useRef(0);

  const flag = useCallback((judgement: Judgement, away: number | null) => {
    seqRef.current += 1;
    setLastHit({ judgement, away, seq: seqRef.current });
  }, []);

  const openAt = useCallback((index: number) => {
    indexRef.current = index;
    pendingRef.current = new Set(gatesRef.current[index]?.pitches ?? []);
    waitingRef.current = false;
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
      const after = gatesRef.current[indexRef.current + 1];
      const deadline = gateDeadline(gate.start, after?.start ?? null);
      if (pendingRef.current.size === 0 || position <= deadline) {
        return;
      }
      if (waitsForYou) {
        pause();
        waitingRef.current = true;
        setWaiting(true);
        return;
      }
      // The band never stops in a battle, so an unplayed note is simply missed.
      const missed = pendingRef.current.size;
      setScore((current) => {
        let next = current;
        for (let count = 0; count < missed; count += 1) {
          next = applyJudgement(next, "miss");
        }
        return next;
      });
      flag("miss", null);
      openAt(indexRef.current + 1);
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
        flag("miss", null);
        return;
      }
      pendingRef.current.delete(pitch);
      const stopped = waitingRef.current;
      const late = position - gate.start;
      const judgement = judge(late);
      if (!stopped) {
        // Kept so a player who is consistently behind can be told what their
        // offset should be. A gate the song stopped for holds the clock still,
        // so its delay belongs to the pause and would teach the wrong offset.
        timingRef.current.push(late);
        if (timingRef.current.length > timedHitsKept) {
          timingRef.current.shift();
        }
      }
      setScore((current) => applyJudgement(current, judgement));
      flag(judgement, late);
      if (pendingRef.current.size === 0) {
        openAt(indexRef.current + 1);
        if (stopped) {
          resume();
        }
      }
    },
    [openAt, resume, flag],
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
