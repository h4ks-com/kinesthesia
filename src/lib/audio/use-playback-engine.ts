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
  latency: () => number;
  getPosition: () => number;
  isPlaying: () => boolean;
  pause: () => void;
  resume: () => void;
};

type Options = {
  song: Song | null;
  autoTracks: ReadonlySet<number>;
  speed: number;
  onRestart: () => void;
};

export function usePlaybackEngine({
  song,
  autoTracks,
  speed,
  onRestart,
}: Options): Playback {
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [soundReady, setSoundReady] = useState(false);
  const engineRef = useRef<PlaybackEngine | null>(null);

  const autoTracksRef = useRef(autoTracks);
  autoTracksRef.current = autoTracks;
  const restartRef = useRef(onRestart);
  restartRef.current = onRestart;

  useEffect(() => {
    if (song === null) {
      return;
    }
    const engine = new PlaybackEngine();
    engineRef.current = engine;
    engine.setSong(song, autoTracksRef.current);
    setPlaying(false);
    setElapsed(0);
    setSoundReady(false);
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, [song]);

  useEffect(() => {
    engineRef.current?.setAutoTracks(autoTracks);
  }, [autoTracks]);

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

  return {
    playing,
    elapsed,
    soundReady,
    toggle,
    seek,
    strike,
    latency: useCallback(() => engineRef.current?.outputLatency ?? 0, []),
    getPosition: useCallback(() => engineRef.current?.position ?? 0, []),
    isPlaying: useCallback(() => engineRef.current?.playing ?? false, []),
    pause: useCallback(() => engineRef.current?.pause(), []),
    resume: useCallback(() => {
      void engineRef.current?.play();
    }, []),
  };
}
