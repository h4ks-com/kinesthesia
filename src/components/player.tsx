"use client";

import { Volume2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PianoRollView } from "@/components/piano-roll-view";
import { PlayerHeader } from "@/components/player-header";
import { PlayerTransport } from "@/components/player-transport";
import { clampLatency, judgedPosition } from "@/lib/audio/latency";
import { usePlaybackEngine } from "@/lib/audio/use-playback-engine";
import { useNoteInput } from "@/lib/input/use-note-input";
import {
  clampMelodyRate,
  type MelodyRate,
  reduceToMelody,
} from "@/lib/midi/melody";
import type { Song } from "@/lib/midi/song";
import { useSong } from "@/lib/midi/use-song";
import {
  asSpeed,
  buildPlayerUrl,
  explicitSongSettings,
  type PlayerMode,
  type PlayerParams,
  type Speed,
} from "@/lib/player-url";
import { clampKeyWidth, defaultKeyWidth } from "@/lib/render/keyboard";
import { busiestTrack } from "@/lib/scoring/gates";
import type { Score } from "@/lib/scoring/judge";
import { useGates } from "@/lib/scoring/use-gates";
import { useRunRecord } from "@/lib/scoring/use-run-record";
import {
  loadGlobalSettings,
  loadSongSettings,
  saveGlobalSettings,
  saveSongSettings,
  songSettingsKey,
} from "@/lib/storage/settings";

type PlayerProps = {
  mode: PlayerMode;
  params: PlayerParams;
  onScore?: (score: Score, position: number) => void;
  onPress?: (pitch: number) => void;
  onRelease?: (pitch: number) => void;
  opponent?: { name: string; points: number; accuracy: number } | null;
  /** A live match freezes the settings, since both sides derive their part
   * from them and have to keep agreeing once the scoring starts. */
  locked?: boolean;
};

export function Player({
  mode,
  params,
  onScore,
  onPress,
  onRelease,
  opponent = null,
  locked = false,
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
  const [simplified, setSimplified] = useState(params.simplified);
  const [melodyRate, setMelodyRate] = useState(params.melodyRate);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const globalTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (settleTimer.current !== null) {
        clearTimeout(settleTimer.current);
      }
      if (globalTimer.current !== null) {
        clearTimeout(globalTimer.current);
      }
    },
    [],
  );

  type SongSettingsValue = {
    tracks: readonly number[];
    speed: Speed;
    simplified: boolean;
    melodyRate: MelodyRate;
  };
  type UrlChange = Partial<SongSettingsValue>;

  // Read at write time, so a deferred write never clobbers a change made after
  // it was scheduled.
  const settingsRef = useRef<SongSettingsValue>({
    tracks: [...playerTracks],
    speed,
    simplified,
    melodyRate,
  });
  settingsRef.current = {
    tracks: [...playerTracks],
    speed,
    simplified,
    melodyRate,
  };

  const merge = useCallback((next: UrlChange): SongSettingsValue => {
    const current = settingsRef.current;
    return {
      tracks: next.tracks ?? current.tracks,
      speed: next.speed ?? current.speed,
      simplified: next.simplified ?? current.simplified,
      melodyRate: next.melodyRate ?? current.melodyRate,
    };
  }, []);

  const updateUrl = useCallback(
    (next: UrlChange) => {
      window.history.replaceState(
        null,
        "",
        buildPlayerUrl(
          window.location.origin,
          mode,
          { ...params, ...merge(next) },
          { explicit: true },
        ),
      );
    },
    [params, mode, merge],
  );

  // A locked match plays the agreed part, so it leaves what this device
  // remembers for the song untouched.
  const commit = useCallback(
    (next: UrlChange) => {
      updateUrl(next);
      if (!locked) {
        void saveSongSettings(
          songSettingsKey(params.source, params.url),
          merge(next),
        );
      }
    },
    [params, locked, updateUrl, merge],
  );

  const bootstrapped = useRef(false);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (bootstrapped.current) {
      return;
    }
    bootstrapped.current = true;
    const explicit = explicitSongSettings(
      new URLSearchParams(window.location.search),
    );
    void loadGlobalSettings().then((stored) => {
      if (stored !== null) {
        setKeyWidth(clampKeyWidth(stored.keyWidth));
        setLatencyOffset(clampLatency(stored.latencyOffset));
      }
    });
    if (locked) {
      setHydrated(true);
      return;
    }
    void loadSongSettings(songSettingsKey(params.source, params.url))
      .then((stored) => {
        if (stored === null) {
          return;
        }
        const next = {
          speed: explicit.has("speed") ? params.speed : asSpeed(stored.speed),
          simplified: explicit.has("simplified")
            ? params.simplified
            : stored.simplified,
          melodyRate: explicit.has("melodyRate")
            ? params.melodyRate
            : clampMelodyRate(stored.melodyRate),
          tracks: explicit.has("tracks") ? null : stored.tracks,
        };
        setSpeed(next.speed);
        setSimplified(next.simplified);
        setMelodyRate(next.melodyRate);
        if (next.tracks !== null) {
          setPlayerTracks(new Set(next.tracks));
        }
        updateUrl({
          speed: next.speed,
          simplified: next.simplified,
          melodyRate: next.melodyRate,
          tracks: next.tracks ?? undefined,
        });
      })
      .finally(() => setHydrated(true));
  }, [params, locked, updateUrl]);

  useEffect(() => {
    if (
      !hydrated ||
      locked ||
      song === null ||
      !interactive ||
      playerTracks.size > 0
    ) {
      return;
    }
    // Publishing the default claim lets a battle invite record the part the
    // host is actually about to play.
    const claimed = busiestTrack(song);
    setPlayerTracks(new Set([claimed]));
    commit({ tracks: [claimed] });
  }, [hydrated, locked, song, interactive, playerTracks.size, commit]);

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

  const owed = useMemo(() => {
    if (song === null || !interactive) {
      return [];
    }
    const mine = song.notes.filter((note) => playerTracks.has(note.track));
    return simplified
      ? reduceToMelody(song, {
          tracks: playerTracks,
          maxNotesPerSecond: melodyRate,
        })
      : mine;
  }, [song, playerTracks, interactive, simplified, melodyRate]);

  const owedIds = useMemo(() => new Set(owed.map((note) => note.id)), [owed]);

  // Learning shows only the part you owe while the rest keeps playing, so
  // hiding a track is a view choice there rather than a mute.
  const autoNotes = useMemo(() => {
    if (song === null) {
      return new Set<number>();
    }
    return new Set(
      song.notes
        .filter(
          (note) =>
            !owedIds.has(note.id) &&
            (interactive || !hiddenTracks.has(note.track)),
        )
        .map((note) => note.id),
    );
  }, [song, hiddenTracks, interactive, owedIds]);

  const resetGates = useCallback(() => gatesRef.current?.reset(), []);
  const playback = usePlaybackEngine({
    song,
    autoNotes,
    speed,
    onRestart: resetGates,
  });

  const gates = useGates({
    owed,
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
    onRelease: useCallback(
      (pitch: number) => {
        playback.release(pitch, ownedTrack);
        onRelease?.(pitch);
      },
      [playback, ownedTrack, onRelease],
    ),
    onToggle: useCallback(() => void playback.toggle(), [playback]),
  });

  /** Opening on the lowest keys hides the part on a phone, where only a slice
   * of the keyboard fits, so the roll starts where the notes are. */
  const focusPitch = useMemo(() => {
    if (song === null) {
      return null;
    }
    const source = owed.length > 0 ? owed : song.notes;
    const pitches = source
      .filter((note) => interactive || !hiddenTracks.has(note.track))
      .map((note) => note.pitch)
      .sort((left, right) => left - right);
    return pitches[Math.floor(pitches.length / 2)] ?? null;
  }, [song, owed, interactive, hiddenTracks]);

  // Interactive modes light only the part you owe and ghost the rest, so the
  // accompaniment and any other track stay visible without competing with it.
  const yoursSet = useMemo(
    () => (interactive ? owedIds : null),
    [interactive, owedIds],
  );
  const yoursRef = useRef(yoursSet);
  yoursRef.current = yoursSet;
  const yours = useCallback(() => yoursRef.current, []);

  useRunRecord({
    mode,
    params,
    score: gates.score,
    elapsed: playback.elapsed,
    duration: song?.duration ?? 0,
    active: interactive,
    speed,
    simplified,
    melodyRate,
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

  // A write per slider step trips Safari's replaceState limit, so the write
  // settles a moment after the last change while state tracks it live.
  function settleCommit(next: UrlChange) {
    if (settleTimer.current !== null) {
      clearTimeout(settleTimer.current);
    }
    settleTimer.current = setTimeout(() => commit(next), 250);
  }

  function settleGlobal(keyWidthNext: number, latencyNext: number) {
    if (globalTimer.current !== null) {
      clearTimeout(globalTimer.current);
    }
    globalTimer.current = setTimeout(
      () =>
        void saveGlobalSettings({
          keyWidth: keyWidthNext,
          latencyOffset: latencyNext,
        }),
      250,
    );
  }

  function changeKeyWidth(next: number) {
    const width = clampKeyWidth(next);
    setKeyWidth(width);
    settleGlobal(width, latencyOffset);
  }

  function changeLatency(next: number) {
    const offset = clampLatency(next);
    setLatencyOffset(offset);
    settleGlobal(keyWidth, offset);
  }

  function changeSimplified(next: boolean) {
    setSimplified(next);
    commit({ simplified: next });
  }

  function changeMelodyRate(next: number) {
    const rate = clampMelodyRate(next);
    setMelodyRate(rate);
    settleCommit({ melodyRate: rate });
  }

  function changeSpeed(next: Speed) {
    setSpeed(next);
    settleCommit({ speed: next });
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
      commit({ tracks: [...next].sort((left, right) => left - right) });
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
        params={{
          ...params,
          tracks: [...playerTracks],
          speed,
          simplified,
          melodyRate,
        }}
        tracks={song.tracks}
        hiddenTracks={hiddenTracks}
        playerTracks={playerTracks}
        interactive={interactive}
        simplified={simplified}
        onSimplified={changeSimplified}
        editable={!locked}
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
          focusPitch={focusPitch}
          getPosition={playback.getPosition}
          getPressed={input.pressed}
          getOwed={gates.owed}
          getYours={yours}
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
        showSpeed={!locked}
        keyWidth={keyWidth}
        onKeyWidth={(next) => changeKeyWidth(next)}
        melodyRate={melodyRate}
        onMelodyRate={changeMelodyRate}
        showMelodyRate={interactive && simplified && !locked}
        octave={interactive ? input.octave : null}
        latencyOffset={latencyOffset}
        onLatencyOffset={(next) => changeLatency(next)}
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
