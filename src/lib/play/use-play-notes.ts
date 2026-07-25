"use client";

import { useCallback, useMemo, useRef } from "react";
import type { LiveNote } from "@/lib/midi/song";

/** Seconds a released note keeps climbing before it is dropped. A shade past
 * the roll's own look ahead, so a note is culled only once it is off screen. */
const trailSeconds = 4.5;

export type PlayNotes = {
  /** A key went down on a part. Stamps the note on the same clock the roll
   * scrolls on, so start it climbing from the keys. */
  emit: (pitch: number, track: number, velocity: number) => void;
  /** The key came up, so the bar stops growing at the length actually played
   * even when the pedal keeps the note sounding. */
  lift: (pitch: number, track: number) => void;
  /** The sound stopped, so the key goes dark. Under the pedal this trails the
   * lift; with no pedal the two land together. */
  damp: (pitch: number, track: number) => void;
  get: () => readonly LiveNote[];
};

function key(track: number, pitch: number): string {
  return `${track}:${pitch}`;
}

export function usePlayNotes(getPosition: () => number): PlayNotes {
  const notes = useRef<LiveNote[]>([]);
  const open = useRef(new Map<string, LiveNote>());
  const nextId = useRef(0);
  const positionRef = useRef(getPosition);
  positionRef.current = getPosition;

  const prune = useCallback((now: number) => {
    notes.current = notes.current.filter(
      (note) => note.end === null || now - note.end < trailSeconds,
    );
  }, []);

  const emit = useCallback(
    (pitch: number, track: number, velocity: number) => {
      const now = positionRef.current();
      // A key struck again before its release closes the first, so the same
      // pitch on one part never leaves an open note behind.
      const previous = open.current.get(key(track, pitch));
      if (previous !== undefined) {
        previous.end = now;
        previous.release = now;
      }
      const note: LiveNote = {
        id: nextId.current++,
        pitch,
        track,
        velocity,
        start: now,
        end: null,
        release: null,
      };
      notes.current.push(note);
      open.current.set(key(track, pitch), note);
      prune(now);
    },
    [prune],
  );

  const lift = useCallback((pitch: number, track: number) => {
    const note = open.current.get(key(track, pitch));
    if (note !== undefined) {
      note.end = positionRef.current();
    }
  }, []);

  const damp = useCallback((pitch: number, track: number) => {
    const note = open.current.get(key(track, pitch));
    if (note !== undefined) {
      const now = positionRef.current();
      note.end ??= now;
      note.release = now;
      open.current.delete(key(track, pitch));
    }
  }, []);

  const get = useCallback(() => {
    prune(positionRef.current());
    return notes.current;
  }, [prune]);

  // A stable object, so the canvas draw effect that lists it as a dependency is
  // not torn down and rebuilt (losing pan and re-sparking) on every render.
  return useMemo(() => ({ emit, lift, damp, get }), [emit, lift, damp, get]);
}
