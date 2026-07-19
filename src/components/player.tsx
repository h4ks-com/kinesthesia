"use client";

import { Volume2 } from "lucide-react";
import {
  forwardRef,
  type ReactNode,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { HitFlag } from "@/components/hit-flag";
import { PianoRollView } from "@/components/piano-roll-view";
import { PlayerHeader } from "@/components/player-header";
import { PlayerTransport, TransportBar } from "@/components/player-transport";
import { clampLatency, judgedPosition } from "@/lib/audio/latency";
import { usePlaybackEngine } from "@/lib/audio/use-playback-engine";
import { useSongVoicing } from "@/lib/audio/use-song-voicing";
import { reachFor } from "@/lib/input/keyboard-map";
import { useNoteInput } from "@/lib/input/use-note-input";
import {
  clampMelodyRate,
  type MelodyRate,
  reduceToMelody,
} from "@/lib/midi/melody";
import {
  medianPitch,
  type Part,
  soloHidden,
  toggleHidden,
  tracksToHide,
} from "@/lib/midi/part";
import {
  clampTranspose,
  defaultTranspose,
  type Song,
  type Transpose,
  transposeSong,
} from "@/lib/midi/song";
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
import type { Judgement, Score } from "@/lib/scoring/judge";
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
  /** Who is signed in, so their own sound for a song wins over the newest. */
  viewerId?: string | null;
  onScore?: (score: Score) => void;
  onHit?: (judgement: Judgement) => void;
  /** Reports the part being played, so a match can mirror it on the other side
   * without reading it back out of the address bar. */
  onConfig?: (part: Part) => void;
  opponent?: { name: string; points: number; accuracy: number } | null;
  /** A live match freezes the settings, since both sides derive their part
   * from them and have to keep agreeing once the scoring starts. */
  locked?: boolean;
  /** A running match round hides the transport, so no one can pause, seek or
   * start on their own; the handle drives playback. */
  matchActive?: boolean;
  /** A match hangs its other half, its overlay and its invite off the player,
   * so one timeline spans both sides and stays on the clock that drives them. */
  aside?: ReactNode;
  overlay?: ReactNode;
  footerExtra?: ReactNode;
  onEnd?: (score: Score) => void;
};

/** The match drives each side's playback through this, so one signal starts a
 * round on both sides. */
export type PlayerHandle = {
  prepare: () => Promise<void>;
  startRound: () => void;
  stop: () => void;
  /** The other half of a match draws off this clock, which is what keeps one
   * timeline walking both rolls. */
  getPosition: () => number;
};

export const Player = forwardRef<PlayerHandle, PlayerProps>(function Player(
  {
    mode,
    params,
    viewerId = null,
    onScore,
    onHit,
    onConfig,
    opponent = null,
    locked = false,
    matchActive = false,
    aside = null,
    overlay = null,
    footerExtra = null,
    onEnd,
  },
  ref,
) {
  const sound = useSongVoicing(params, viewerId);
  const load = useSong(params);
  const original = load.status === "ready" ? load.song : null;
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
  const [transpose, setTranspose] = useState(params.transpose);
  // Only watch has nothing to report, so no mode can hide its own scoring.
  const focusable = mode === "watch";
  const [focus, setFocus] = useState(focusable && params.focus);
  const focusRef = useRef(focus);
  focusRef.current = focus;

  const song = useMemo(
    () => (original === null ? null : transposeSong(original, transpose)),
    [original, transpose],
  );
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
    transpose: Transpose;
  };
  type UrlChange = Partial<SongSettingsValue>;

  // Read at write time, so a deferred write never clobbers a change made after
  // it was scheduled.
  const settingsRef = useRef<SongSettingsValue>({
    tracks: [...playerTracks],
    speed,
    simplified,
    melodyRate,
    transpose,
  });
  settingsRef.current = {
    tracks: [...playerTracks],
    speed,
    simplified,
    melodyRate,
    transpose,
  };

  const merge = useCallback((next: UrlChange): SongSettingsValue => {
    const current = settingsRef.current;
    return {
      tracks: next.tracks ?? current.tracks,
      speed: next.speed ?? current.speed,
      simplified: next.simplified ?? current.simplified,
      melodyRate: next.melodyRate ?? current.melodyRate,
      transpose: next.transpose ?? current.transpose,
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
          { ...params, focus: focusRef.current, ...merge(next) },
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

  const changeFocus = useCallback(
    (next: boolean) => {
      setFocus(next);
      focusRef.current = next;
      updateUrl({});
    },
    [updateUrl],
  );

  useEffect(() => {
    if (!focus) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        changeFocus(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focus, changeFocus]);

  // Focus mode leaves nothing on screen to click and nothing to tab to, so
  // arriving on a focused link has to say how to get back out. It fades so a
  // recording started a moment later is clean.
  const stage = useRef<HTMLDivElement | null>(null);
  const [wayOut, setWayOut] = useState(false);
  const rollUp = song !== null;
  useEffect(() => {
    if (!focus || !rollUp) {
      setWayOut(false);
      return;
    }
    setWayOut(true);
    stage.current?.focus();
    const timer = setTimeout(() => setWayOut(false), 4000);
    return () => clearTimeout(timer);
  }, [focus, rollUp]);

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
          transpose: explicit.has("transpose")
            ? params.transpose
            : clampTranspose(stored.transpose ?? defaultTranspose),
          tracks: explicit.has("tracks") ? null : stored.tracks,
        };
        setSpeed(next.speed);
        setSimplified(next.simplified);
        setMelodyRate(next.melodyRate);
        setTranspose(next.transpose);
        if (next.tracks !== null) {
          setPlayerTracks(new Set(next.tracks));
        }
        updateUrl({
          speed: next.speed,
          simplified: next.simplified,
          melodyRate: next.melodyRate,
          transpose: next.transpose,
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
    // Publishing the default claim lets a multiplayer invite record the part
    // the host is actually about to play.
    const claimed = busiestTrack(song);
    setPlayerTracks(new Set([claimed]));
    commit({ tracks: [claimed] });
  }, [hydrated, locked, song, interactive, playerTracks.size, commit]);

  const focusedSong = useRef<Song | null>(null);
  useEffect(() => {
    if (
      original === null ||
      song === null ||
      !interactive ||
      playerTracks.size === 0
    ) {
      return;
    }
    if (focusedSong.current === original) {
      return;
    }
    focusedSong.current = original;
    setHiddenTracks(tracksToHide(song, playerTracks));
  }, [song, original, interactive, playerTracks]);

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
    sourceKey: params.url,
    autoNotes,
    speed,
    onRestart: resetGates,
  });

  useEffect(() => {
    playback.setVoicing(sound.voicing);
  }, [playback.setVoicing, sound.voicing]);

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

  // The end is only counted for a round that actually started, so a song left
  // at its end during preview does not report a finish the moment a match opens.
  const startedRef = useRef(false);
  const endedRef = useRef(false);

  const seekPlayback = playback.seek;
  const seek = useCallback(
    (position: number) => {
      seekPlayback(position);
      gatesRef.current.moveTo(position);
    },
    [seekPlayback],
  );

  const offsetRef = useRef(latencyOffset);
  offsetRef.current = latencyOffset;
  const ownedTrack = [...playerTracks][0] ?? 0;
  const input = useNoteInput({
    active: interactive,
    onPress: useCallback(
      (pitch: number, velocity: number, at: number) => {
        playback.strike(pitch, velocity, ownedTrack);
        // A match only scores a struck note once its round is running, so keys
        // pressed during the countdown or result never count or reach the peer.
        if (interactive && (mode !== "multiplayer" || startedRef.current)) {
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
      [playback, ownedTrack, interactive, mode],
    ),
    onRelease: useCallback(
      (pitch: number) => {
        playback.release(pitch, ownedTrack);
      },
      [playback, ownedTrack],
    ),
    onToggle: useCallback(() => {
      if (!matchActive) {
        void playback.toggle();
      }
    }, [playback, matchActive]),
  });

  /** Opening on the lowest keys hides the part on a phone, where only a slice
   * of the keyboard fits, so the roll starts where the notes are. */
  const focusPitch = useMemo(() => {
    if (song === null) {
      return null;
    }
    const source = owed.length > 0 ? owed : song.notes;
    return medianPitch(
      source.filter((note) => interactive || !hiddenTracks.has(note.track)),
    );
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

  useEffect(() => {
    onScore?.(gates.score);
  }, [gates.score, onScore]);

  const configRef = useRef(onConfig);
  configRef.current = onConfig;
  useEffect(() => {
    configRef.current?.({
      tracks: [...playerTracks].sort((left, right) => left - right),
      simplified,
      melodyRate,
    });
  }, [playerTracks, simplified, melodyRate]);

  const hitRef = useRef(gates.lastHit?.seq ?? 0);
  useEffect(() => {
    const hit = gates.lastHit;
    if (hit === null || hit.seq === hitRef.current) {
      return;
    }
    hitRef.current = hit.seq;
    onHit?.(hit.judgement);
  }, [gates.lastHit, onHit]);

  useImperativeHandle(
    ref,
    () => ({
      prepare: () => playback.prepare(),
      startRound: () => {
        startedRef.current = true;
        endedRef.current = false;
        void playback.restart();
      },
      stop: () => {
        startedRef.current = false;
        endedRef.current = true;
        playback.pause();
      },
      getPosition: () => playback.getPosition(),
    }),
    [playback],
  );

  const endRef = useRef(onEnd);
  endRef.current = onEnd;
  useEffect(() => {
    if (
      !matchActive ||
      !startedRef.current ||
      song === null ||
      endedRef.current ||
      playback.elapsed < song.duration
    ) {
      return;
    }
    startedRef.current = false;
    endedRef.current = true;
    endRef.current?.(gates.score);
  }, [matchActive, song, playback.elapsed, gates.score]);

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

  function changeTranspose(next: Transpose) {
    setTranspose(next);
    settleCommit({ transpose: next });
  }

  function changeSpeed(next: Speed) {
    setSpeed(next);
    settleCommit({ speed: next });
  }

  function toggleTrack(index: number) {
    setHiddenTracks((current) => toggleHidden(current, index));
  }

  function soloTrack(index: number) {
    const all = song?.tracks.map((track) => track.index) ?? [];
    setHiddenTracks((current) => soloHidden(all, current, index));
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

  // The frame stays up while the song loads or fails, because a match hangs its
  // other half, its overlay and its invite off it and would go dark with it.
  if (song === null) {
    return (
      <div className="flex h-dvh flex-col overflow-hidden bg-void">
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
            <p className="flex flex-1 items-center justify-center px-6 text-center text-muted text-sm">
              {load.status === "failed" ? load.message : "Loading the song"}
            </p>
            {overlay}
          </div>
          {aside}
        </div>
        {footerExtra === null ? null : (
          <TransportBar>
            <span className="min-w-0 flex-1" />
            {footerExtra}
          </TransportBar>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-void">
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {focus ? null : (
            <PlayerHeader
              mode={mode}
              params={{
                ...params,
                tracks: [...playerTracks],
                speed,
                simplified,
                melodyRate,
                transpose,
                focus: focusable && focus,
              }}
              tracks={song.tracks}
              hiddenTracks={hiddenTracks}
              playerTracks={playerTracks}
              interactive={interactive}
              simplified={simplified}
              onSimplified={changeSimplified}
              melodyRate={melodyRate}
              onMelodyRate={changeMelodyRate}
              editable={!locked}
              score={gates.score}
              opponent={opponent}
              onToggleVisible={toggleTrack}
              onToggleMine={togglePlayerTrack}
              onSolo={soloTrack}
              voicing={sound.voicing}
              onVoicing={sound.change}
              sound={{
                playing: sound.playing,
                dirty: sound.dirty,
                canSave: viewerId !== null,
                onSave: () => void sound.save(),
                onReset: sound.reset,
              }}
              onFocus={focusable ? () => changeFocus(true) : null}
            />
          )}

          <div
            ref={stage}
            tabIndex={-1}
            className="relative min-h-0 flex-1 outline-none"
          >
            <PianoRollView
              song={song}
              hiddenTracks={hiddenTracks}
              keyWidth={keyWidth}
              focusPitch={focusPitch}
              getPosition={playback.getPosition}
              getPressed={input.pressed}
              getOwed={gates.owed}
              getYours={yours}
              reach={interactive ? reachFor(input.octave) : null}
              onStrike={(pitch) => input.press(pitch, 0.8)}
              onRelease={input.release}
            />
            {interactive ? <HitFlag hit={gates.lastHit} /> : null}
            {gates.waiting ? (
              <p className="rise -translate-x-1/2 absolute top-6 left-1/2 rounded-full border border-accent/40 bg-panel/90 px-4 py-1.5 font-mono text-accent text-xs backdrop-blur">
                waiting for you
              </p>
            ) : null}
            {wayOut ? (
              <p
                aria-live="polite"
                className="fade-out -translate-x-1/2 absolute bottom-[22%] left-1/2 rounded-full border border-line-strong bg-panel/90 px-4 py-1.5 font-mono text-muted text-xs backdrop-blur"
              >
                esc to leave focus
              </p>
            ) : null}
            {playback.soundReady || mode === "multiplayer" ? null : (
              <p className="-translate-x-1/2 absolute top-6 left-1/2 flex items-center gap-2 whitespace-nowrap rounded-full border border-line-strong bg-panel/90 px-4 py-1.5 text-muted text-xs backdrop-blur">
                <Volume2 className="size-3.5 shrink-0" aria-hidden="true" />
                press play to start the sound
              </p>
            )}
          </div>
          {overlay}
        </div>
        {aside}
      </div>

      {focus ? null : (
        <TransportBar>
          <PlayerTransport
            playing={playback.playing}
            elapsed={playback.elapsed}
            duration={song.duration}
            speed={speed}
            onSpeed={locked ? null : changeSpeed}
            transpose={transpose}
            onTranspose={locked ? null : changeTranspose}
            keyWidth={keyWidth}
            onKeyWidth={(next) => changeKeyWidth(next)}
            octave={interactive ? input.octave : null}
            latencyOffset={latencyOffset}
            onLatencyOffset={(next) => changeLatency(next)}
            measuredLatency={playback.latency()}
            showLatency={interactive}
            inputStatus={input.status}
            // A running match owns the clock, so nobody plays or seeks by hand.
            onToggle={matchActive ? null : () => void playback.toggle()}
            onSeek={matchActive ? null : seek}
            onOctave={input.setOctave}
          />
          {footerExtra}
        </TransportBar>
      )}
    </div>
  );
});
