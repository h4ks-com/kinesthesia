"use client";

import { Volume2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PianoRollView } from "@/components/piano-roll-view";
import { PlayerHeader } from "@/components/player-header";
import { PlayerTransport } from "@/components/player-transport";
import { clampLatency, judgedPosition } from "@/lib/audio/latency";
import { usePlaybackEngine } from "@/lib/audio/use-playback-engine";
import { useNoteInput } from "@/lib/input/use-note-input";
import type { Song } from "@/lib/midi/song";
import { useSong } from "@/lib/midi/use-song";
import {
  buildPlayerUrl,
  type PlayerMode,
  type PlayerParams,
  type Speed,
} from "@/lib/player-url";
import { clampKeyWidth, defaultKeyWidth } from "@/lib/render/keyboard";
import { busiestTrack } from "@/lib/scoring/gates";
import type { Score } from "@/lib/scoring/judge";
import { useGates } from "@/lib/scoring/use-gates";

type PlayerProps = {
  mode: PlayerMode;
  params: PlayerParams;
  onScore?: (score: Score, position: number) => void;
  onPress?: (pitch: number) => void;
  onRelease?: (pitch: number) => void;
  opponent?: { name: string; points: number; accuracy: number } | null;
};

export function Player({
  mode,
  params,
  onScore,
  onPress,
  onRelease,
  opponent = null,
}: PlayerProps) {
  const load = useSong(params);
  const song = load.status === "ready" ? load.song : null;
  const interactive = mode !== "watch";
  const waitsForYou = mode === "learn";

  const [hiddenTracks, setHiddenTracks] = useState<ReadonlySet<number>>(
    new Set(),
  );
  const [playerTracks, setPlayerTracks] = useState<ReadonlySet<number>>(
    new Set(params.tracks ?? []),
  );
  const [speed, setSpeed] = useState(params.speed);
  const [latencyOffset, setLatencyOffset] = useState(0);
  const [keyWidth, setKeyWidth] = useState(defaultKeyWidth);

  useEffect(() => {
    if (song === null || !interactive || playerTracks.size > 0) {
      return;
    }
    setPlayerTracks(new Set([busiestTrack(song)]));
  }, [song, interactive, playerTracks.size]);

  const focusedSong = useRef<Song | null>(null);
  useEffect(() => {
    if (song === null || !interactive || playerTracks.size === 0) {
      return;
    }
    if (focusedSong.current === song) {
      return;
    }
    focusedSong.current = song;
    setHiddenTracks(
      new Set(
        song.tracks
          .map((track) => track.index)
          .filter((index) => !playerTracks.has(index)),
      ),
    );
  }, [song, interactive, playerTracks]);

  // Learning shows only the part you owe while the rest keeps playing, so
  // hiding a track is a view choice there rather than a mute.
  const autoTracks = useMemo(() => {
    if (song === null) {
      return new Set<number>();
    }
    return new Set(
      song.tracks
        .map((track) => track.index)
        .filter((index) =>
          interactive ? !playerTracks.has(index) : !hiddenTracks.has(index),
        ),
    );
  }, [song, hiddenTracks, playerTracks, interactive]);

  const resetGates = useCallback(() => gatesRef.current?.reset(), []);
  const playback = usePlaybackEngine({
    song,
    autoTracks,
    speed,
    onRestart: resetGates,
  });

  const gates = useGates({
    song,
    playerTracks,
    active: interactive,
    waitsForYou,
    getPosition: playback.getPosition,
    isPlaying: playback.isPlaying,
    pause: playback.pause,
    resume: playback.resume,
  });
  const gatesRef = useRef(gates);
  gatesRef.current = gates;

  const offsetRef = useRef(latencyOffset);
  offsetRef.current = latencyOffset;
  const ownedTrack = [...playerTracks][0] ?? 0;
  const input = useNoteInput({
    active: interactive,
    onPress: useCallback(
      (pitch: number, velocity: number, at: number) => {
        playback.strike(pitch, velocity, ownedTrack);
        onPress?.(pitch);
        if (interactive) {
          gatesRef.current.judgeStrike(
            pitch,
            judgedPosition(
              playback.getPosition(),
              at,
              performance.now(),
              playback.latency(),
              offsetRef.current,
            ),
          );
        }
      },
      [playback, ownedTrack, interactive, onPress],
    ),
    onRelease,
    onToggle: useCallback(() => void playback.toggle(), [playback]),
  });

  const positionRef = useRef(playback.getPosition);
  positionRef.current = playback.getPosition;
  useEffect(() => {
    onScore?.(gates.score, positionRef.current());
  }, [gates.score, onScore]);

  function seek(position: number) {
    playback.seek(position);
    gates.moveTo(position);
  }

  function updateUrl(next: { tracks?: readonly number[]; speed?: Speed }) {
    window.history.replaceState(
      null,
      "",
      buildPlayerUrl(window.location.origin, mode, {
        ...params,
        tracks: next.tracks ?? [...playerTracks],
        speed: next.speed ?? speed,
      }),
    );
  }

  function changeSpeed(next: Speed) {
    setSpeed(next);
    updateUrl({ speed: next });
  }

  function toggleTrack(index: number) {
    setHiddenTracks((current) => {
      const next = new Set(current);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }

  function soloTrack(index: number) {
    const all = song?.tracks.map((track) => track.index) ?? [];
    setHiddenTracks((current) => {
      const alreadySolo =
        all.filter((other) => !current.has(other)).length === 1 &&
        !current.has(index);
      return alreadySolo
        ? new Set()
        : new Set(all.filter((other) => other !== index));
    });
  }

  function togglePlayerTrack(index: number) {
    setPlayerTracks((current) => {
      const next = new Set(current);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      updateUrl({ tracks: [...next].sort((left, right) => left - right) });
      return next;
    });
  }

  if (load.status === "loading") {
    return <Centered>Loading the song</Centered>;
  }
  if (load.status === "failed") {
    return <Centered>{load.message}</Centered>;
  }
  if (song === null) {
    return null;
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-void">
      <PlayerHeader
        mode={mode}
        params={params}
        tracks={song.tracks}
        hiddenTracks={hiddenTracks}
        playerTracks={playerTracks}
        interactive={interactive}
        score={gates.score}
        opponent={opponent}
        onToggleVisible={toggleTrack}
        onToggleMine={togglePlayerTrack}
        onSolo={soloTrack}
      />

      <div className="relative min-h-0 flex-1">
        <PianoRollView
          song={song}
          hiddenTracks={hiddenTracks}
          keyWidth={keyWidth}
          getPosition={playback.getPosition}
          getPressed={input.pressed}
          onStrike={(pitch) => input.press(pitch, 0.8)}
          onRelease={input.release}
        />
        {gates.waiting ? (
          <p className="rise -translate-x-1/2 absolute top-6 left-1/2 rounded-full border border-accent/40 bg-panel/90 px-4 py-1.5 font-mono text-accent text-xs backdrop-blur">
            waiting for you
          </p>
        ) : null}
        {playback.soundReady ? null : (
          <p className="-translate-x-1/2 absolute top-6 left-1/2 flex items-center gap-2 whitespace-nowrap rounded-full border border-line-strong bg-panel/90 px-4 py-1.5 text-muted text-xs backdrop-blur">
            <Volume2 className="size-3.5 shrink-0" aria-hidden="true" />
            press play to start the sound
          </p>
        )}
      </div>

      <PlayerTransport
        playing={playback.playing}
        elapsed={playback.elapsed}
        duration={song.duration}
        speed={speed}
        showSpeed={mode !== "battle"}
        keyWidth={keyWidth}
        onKeyWidth={(next) => setKeyWidth(clampKeyWidth(next))}
        octave={interactive ? input.octave : null}
        latencyOffset={latencyOffset}
        onLatencyOffset={(next) => setLatencyOffset(clampLatency(next))}
        measuredLatency={playback.latency()}
        showLatency={interactive}
        inputStatus={input.status}
        onToggle={() => void playback.toggle()}
        onSeek={seek}
        onSpeed={changeSpeed}
        onOctave={input.setOctave}
      />
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-void px-6 text-center text-muted">
      {children}
    </div>
  );
}
