"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PlaybackEngine } from "@/lib/audio/engine";
import type { Song } from "@/lib/midi/song";

export type Playback = {
  playing: boolean;
  elapsed: number;
  soundReady: boolean;
  toggle: () => Promise<void>;
  seek: (position: number) => void;
  strike: (pitch: number, velocity: number, track: number) => void;
  release: (pitch: number, track: number) => void;
  prepare: () => Promise<void>;
  restart: () => Promise<void>;
  latency: () => number;
  getPosition: () => number;
  isPlaying: () => boolean;
  pause: () => void;
  resume: () => void;
};

type Options = {
  song: Song | null;
  autoNotes: ReadonlySet<number>;
  speed: number;
  onRestart: () => void;
};

export function usePlaybackEngine({
  song,
  autoNotes,
  speed,
  onRestart,
}: Options): Playback {
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [soundReady, setSoundReady] = useState(false);
  const engineRef = useRef<PlaybackEngine | null>(null);

  const autoNotesRef = useRef(autoNotes);
  autoNotesRef.current = autoNotes;
  const restartRef = useRef(onRestart);
  restartRef.current = onRestart;

  useEffect(() => {
    if (song === null) {
      return;
    }
    const engine = new PlaybackEngine();
    engineRef.current = engine;
    engine.setSong(song, autoNotesRef.current);
    setPlaying(false);
    setElapsed(0);
    setSoundReady(false);
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, [song]);

  useEffect(() => {
    engineRef.current?.setAutoNotes(autoNotes);
  }, [autoNotes]);

  useEffect(() => {
    engineRef.current?.setRate(speed);
  }, [speed]);

  useEffect(() => {
    const timer = setInterval(() => {
      const engine = engineRef.current;
      if (engine === null) {
        return;
      }
      setElapsed(engine.position);
      if (song !== null && engine.playing && engine.position >= song.duration) {
        engine.pause();
        setPlaying(false);
      }
    }, 100);
    return () => clearInterval(timer);
  }, [song]);

  const seek = useCallback((position: number) => {
    engineRef.current?.seek(position);
    setElapsed(position);
  }, []);

  const toggle = useCallback(async () => {
    const engine = engineRef.current;
    if (engine === null || song === null) {
      return;
    }
    if (engine.playing) {
      engine.pause();
      setPlaying(false);
      return;
    }
    if (engine.position >= song.duration - 0.1) {
      engine.seek(0);
      setElapsed(0);
      restartRef.current();
    }
    await engine.play();
    setSoundReady(true);
    setPlaying(true);
    void engine.warmInstruments(song);
  }, [song]);

  const strike = useCallback(
    (pitch: number, velocity: number, track: number) => {
      engineRef.current?.strike(pitch, velocity, track);
    },
    [],
  );

  const release = useCallback((pitch: number, track: number) => {
    engineRef.current?.release(pitch, track);
  }, []);

  // Unlocks audio inside a user gesture and preloads the instruments, so a
  // countdown can then start the sound without a click of its own.
  const prepare = useCallback(async () => {
    const engine = engineRef.current;
    if (engine === null || song === null) {
      return;
    }
    await engine.warmInstruments(song);
    setSoundReady(true);
  }, [song]);

  const restart = useCallback(async () => {
    const engine = engineRef.current;
    if (engine === null || song === null) {
      return;
    }
    engine.seek(0);
    setElapsed(0);
    restartRef.current();
    await engine.play();
    setSoundReady(true);
    setPlaying(true);
  }, [song]);

  return {
    playing,
    elapsed,
    soundReady,
    toggle,
    seek,
    strike,
    release,
    prepare,
    restart,
    latency: useCallback(() => engineRef.current?.outputLatency ?? 0, []),
    getPosition: useCallback(() => engineRef.current?.position ?? 0, []),
    isPlaying: useCallback(() => engineRef.current?.playing ?? false, []),
    pause: useCallback(() => engineRef.current?.pause(), []),
    resume: useCallback(() => {
      void engineRef.current?.play();
    }, []),
  };
}
