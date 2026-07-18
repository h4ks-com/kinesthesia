"use client";

import {
  Eye,
  Gauge,
  GraduationCap,
  Pause,
  Piano,
  Play,
  Swords,
  Volume2,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PianoRollView } from "@/components/piano-roll-view";
import { TrackMenu } from "@/components/track-menu";
import { Popover } from "@/components/ui/popover";
import { PlaybackEngine } from "@/lib/audio/engine";
import {
  clampOctave,
  defaultOctave,
  octaveDownCodes,
  octaveUpCodes,
  pitchForCode,
} from "@/lib/input/keyboard-map";
import { connectMidiInputs, isWebMidiSupported } from "@/lib/input/web-midi";
import { loadSong, type Song } from "@/lib/midi/song";
import {
  buildPlayerUrl,
  defaultSpeed,
  type PlayerMode,
  type PlayerParams,
  playerPath,
  speeds,
} from "@/lib/player-url";
import {
  accuracy,
  applyJudgement,
  emptyScore,
  goodWindow,
  judge,
  type Score,
  scorePoints,
} from "@/lib/scoring/judge";
import { recordPlay } from "@/lib/storage/library";

const chordWindow = 0.03;

type LoadState =
  | { status: "loading" }
  | { status: "failed"; message: string }
  | { status: "ready"; song: Song };

type Gate = { readonly start: number; readonly pitches: readonly number[] };

function buildGates(song: Song, playerTracks: ReadonlySet<number>): Gate[] {
  const notes = song.notes.filter((note) => playerTracks.has(note.track));
  const gates: Gate[] = [];
  for (const note of notes) {
    const last = gates[gates.length - 1];
    if (last !== undefined && note.start - last.start <= chordWindow) {
      gates[gates.length - 1] = {
        start: last.start,
        pitches: [...last.pitches, note.pitch],
      };
      continue;
    }
    gates.push({ start: note.start, pitches: [note.pitch] });
  }
  return gates;
}

function defaultPlayerTrack(song: Song): number {
  let best = song.tracks[0]?.index ?? 0;
  let bestCount = -1;
  for (const track of song.tracks) {
    if (track.noteCount > bestCount) {
      best = track.index;
      bestCount = track.noteCount;
    }
  }
  return best;
}

function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

const otherModes = [
  { mode: "watch", label: "Watch", icon: Eye },
  { mode: "learn", label: "Learn", icon: GraduationCap },
  { mode: "battle", label: "Battle", icon: Swords },
] as const satisfies readonly {
  mode: PlayerMode;
  label: string;
  icon: typeof Eye;
}[];

type PlayerProps = {
  mode: PlayerMode;
  params: PlayerParams;
  onScore?: (score: Score) => void;
  opponent?: { name: string; points: number; accuracy: number } | null;
};

export function Player({ mode, params, onScore, opponent }: PlayerProps) {
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [playing, setPlaying] = useState(false);
  const [hiddenTracks, setHiddenTracks] = useState<ReadonlySet<number>>(
    new Set(),
  );
  const [playerTracks, setPlayerTracks] = useState<ReadonlySet<number>>(
    new Set(params.tracks ?? []),
  );
  const [score, setScore] = useState<Score>(emptyScore);
  const [waiting, setWaiting] = useState(false);
  const [octave, setOctave] = useState(defaultOctave);
  const [midiReady, setMidiReady] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [soundReady, setSoundReady] = useState(false);
  const [speed, setSpeed] = useState(params.speed);

  const engineRef = useRef<PlaybackEngine | null>(null);
  const pressedRef = useRef<Set<number>>(new Set());
  const gatesRef = useRef<Gate[]>([]);
  const gateIndexRef = useRef(0);
  const pendingRef = useRef<Set<number>>(new Set());
  const octaveRef = useRef(octave);
  octaveRef.current = octave;
  const playingRef = useRef(playing);
  playingRef.current = playing;

  const interactive = mode !== "watch";
  const waitsForYou = mode === "learn";
  const song = load.status === "ready" ? load.song : null;

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: "loading" });
    loadSong(params.url, params.name)
      .then((loaded) => {
        if (!cancelled) {
          setLoad({ status: "ready", song: loaded });
          void recordPlay({
            url: params.url,
            name: params.name,
            source: params.source,
          });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoad({
            status: "failed",
            message:
              error instanceof Error
                ? error.message
                : "Could not load that song",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [params.url, params.name, params.source]);

  useEffect(() => {
    if (song === null || !interactive || playerTracks.size > 0) {
      return;
    }
    setPlayerTracks(new Set([defaultPlayerTrack(song)]));
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

  const autoTracksRef = useRef(autoTracks);
  autoTracksRef.current = autoTracks;

  useEffect(() => {
    if (song === null) {
      return;
    }
    const engine = new PlaybackEngine();
    engineRef.current = engine;
    engine.setSong(song, autoTracksRef.current);
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
    if (song === null || !interactive) {
      gatesRef.current = [];
      return;
    }
    gatesRef.current = buildGates(song, playerTracks);
    gateIndexRef.current = 0;
    pendingRef.current = new Set(gatesRef.current[0]?.pitches ?? []);
    setScore(emptyScore);
  }, [song, playerTracks, interactive]);

  useEffect(() => {
    onScore?.(score);
  }, [score, onScore]);

  useEffect(() => {
    const timer = setInterval(() => {
      const engine = engineRef.current;
      if (engine === null) {
        return;
      }
      const position = engine.position;
      setElapsed(position);
      if (song !== null && engine.playing && position >= song.duration) {
        engine.pause();
        setPlaying(false);
        setWaiting(false);
      }
    }, 100);
    return () => clearInterval(timer);
  }, [song]);

  const getPosition = useCallback(() => engineRef.current?.position ?? 0, []);
  const getPressed = useCallback(
    () => pressedRef.current as ReadonlySet<number>,
    [],
  );

  const openGate = useCallback(() => {
    const engine = engineRef.current;
    gateIndexRef.current += 1;
    pendingRef.current = new Set(
      gatesRef.current[gateIndexRef.current]?.pitches ?? [],
    );
    setWaiting(false);
    if (engine !== null && playingRef.current) {
      void engine.play();
    }
  }, []);

  const strike = useCallback(
    (pitch: number, velocity: number) => {
      const engine = engineRef.current;
      if (engine === null) {
        return;
      }
      const owned = [...playerTracks][0] ?? 0;
      void engine.strike(pitch, velocity, owned);
      pressedRef.current.add(pitch);
      if (!interactive) {
        return;
      }
      const gate = gatesRef.current[gateIndexRef.current];
      if (gate === undefined) {
        return;
      }
      if (!pendingRef.current.has(pitch)) {
        setScore((current) => applyJudgement(current, "miss"));
        return;
      }
      pendingRef.current.delete(pitch);
      setScore((current) =>
        applyJudgement(current, judge(engine.position - gate.start)),
      );
      if (pendingRef.current.size === 0) {
        openGate();
      }
    },
    [interactive, openGate, playerTracks],
  );

  const release = useCallback((pitch: number) => {
    pressedRef.current.delete(pitch);
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
      pressedRef.current.clear();
      gateIndexRef.current = 0;
      pendingRef.current = new Set(gatesRef.current[0]?.pitches ?? []);
      setWaiting(false);
    }
    await engine.play();
    setSoundReady(true);
    setPlaying(true);
    void engine.warmInstruments(song);
  }, [song]);

  useEffect(() => {
    if (!interactive) {
      return;
    }
    const onDown = (event: KeyboardEvent) => {
      if (event.repeat) {
        return;
      }
      if (octaveDownCodes.has(event.code)) {
        event.preventDefault();
        setOctave((current) => clampOctave(current - 1));
        return;
      }
      if (octaveUpCodes.has(event.code)) {
        event.preventDefault();
        setOctave((current) => clampOctave(current + 1));
        return;
      }
      const pitch = pitchForCode(event.code, octaveRef.current);
      if (pitch !== null) {
        event.preventDefault();
        strike(pitch, 0.8);
      }
    };
    const onUp = (event: KeyboardEvent) => {
      const pitch = pitchForCode(event.code, octaveRef.current);
      if (pitch !== null) {
        release(pitch);
      }
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, [interactive, strike, release]);

  useEffect(() => {
    if (!interactive || !isWebMidiSupported()) {
      return;
    }
    let disconnect: (() => void) | null = null;
    connectMidiInputs((event) => {
      if (event.down) {
        strike(event.pitch, event.velocity);
      } else {
        release(event.pitch);
      }
    })
      .then((cleanup) => {
        disconnect = cleanup;
        setMidiReady(true);
      })
      .catch(() => setMidiReady(false));
    return () => disconnect?.();
  }, [interactive, strike, release]);

  useEffect(() => {
    if (!interactive) {
      return;
    }
    const timer = setInterval(() => {
      const engine = engineRef.current;
      const gate = gatesRef.current[gateIndexRef.current];
      if (engine === null || gate === undefined || !engine.playing) {
        return;
      }
      if (engine.position < gate.start || pendingRef.current.size === 0) {
        return;
      }
      if (waitsForYou) {
        engine.pause();
        setWaiting(true);
        return;
      }
      // The band never stops, so an unplayed note is simply missed.
      if (engine.position > gate.start + goodWindow) {
        const missed = pendingRef.current.size;
        setScore((current) => {
          let next = current;
          for (let index = 0; index < missed; index += 1) {
            next = applyJudgement(next, "miss");
          }
          return next;
        });
        openGate();
      }
    }, 16);
    return () => clearInterval(timer);
  }, [interactive, waitsForYou, openGate]);

  useEffect(() => {
    const onSpace = (event: KeyboardEvent) => {
      if (event.code !== "Space") {
        return;
      }
      // Space belongs to whatever control has focus before it means play.
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("button, a, input, select, textarea")
      ) {
        return;
      }
      event.preventDefault();
      void toggle();
    };
    window.addEventListener("keydown", onSpace);
    return () => window.removeEventListener("keydown", onSpace);
  }, [toggle]);

  function scrub(position: number) {
    const engine = engineRef.current;
    if (engine === null) {
      return;
    }
    engine.seek(position);
    setElapsed(position);
    pressedRef.current.clear();
    const gates = gatesRef.current;
    let index = 0;
    while (index < gates.length && (gates[index]?.start ?? 0) < position) {
      index += 1;
    }
    gateIndexRef.current = index;
    pendingRef.current = new Set(gates[index]?.pitches ?? []);
    setWaiting(false);
  }

  function changeSpeed(next: number) {
    setSpeed(next);
    window.history.replaceState(
      null,
      "",
      buildPlayerUrl(window.location.origin, mode, {
        ...params,
        tracks: [...playerTracks],
        speed: next,
      }),
    );
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

  function togglePlayerTrack(index: number) {
    setPlayerTracks((current) => {
      const next = new Set(current);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      window.history.replaceState(
        null,
        "",
        buildPlayerUrl(window.location.origin, mode, {
          ...params,
          tracks: [...next].sort((left, right) => left - right),
        }),
      );
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

  const switchable = otherModes.filter((entry) =>
    mode === "battle" ? false : entry.mode !== mode,
  );

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-void">
      <header className="relative z-50 flex h-14 shrink-0 items-center gap-3 border-line border-b bg-panel/90 px-4 backdrop-blur">
        <Link
          href="/"
          data-tip="Back to search"
          aria-label="Back to search"
          className="flex items-center gap-2 rounded-lg px-1.5 py-1 font-semibold tracking-tight transition-colors hover:text-accent"
        >
          <Piano className="size-[18px] text-accent" aria-hidden="true" />
          <span className="hidden sm:inline">Kinesthesia</span>
        </Link>

        <span className="min-w-0 flex-1 truncate text-muted text-sm">
          {params.name}
        </span>

        <span className="label hidden shrink-0 md:inline">{mode}</span>

        <div className="flex shrink-0 items-center gap-2">
          {interactive ? (
            <span className="hidden items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 font-mono text-xs sm:flex">
              <span className="text-accent">{scorePoints(score)}</span>
              <span className="text-faint">
                {Math.round(accuracy(score) * 100)}% · {score.combo}x
              </span>
            </span>
          ) : null}

          {opponent != null ? (
            <span className="flex items-center gap-2 rounded-lg border border-line-strong bg-raised px-2.5 py-1.5 font-mono text-xs">
              <span className="max-w-24 truncate">{opponent.name}</span>
              <span className="text-accent">{opponent.points}</span>
            </span>
          ) : null}

          <TrackMenu
            tracks={song.tracks}
            hidden={hiddenTracks}
            mine={playerTracks}
            interactive={interactive}
            onToggleVisible={toggleTrack}
            onToggleMine={togglePlayerTrack}
            onSolo={soloTrack}
          />

          {switchable.map(({ mode: target, label, icon: Icon }) => (
            <Link
              key={target}
              href={playerPath(target, {
                ...params,
                tracks: [...playerTracks],
              })}
              data-tip={`Switch to ${label.toLowerCase()}`}
              aria-label={`Switch to ${label}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-2 font-medium text-sm transition-colors hover:border-accent hover:text-accent"
            >
              <Icon className="size-4" aria-hidden="true" />
              <span className="hidden lg:inline">{label}</span>
            </Link>
          ))}
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        <PianoRollView
          song={song}
          hiddenTracks={hiddenTracks}
          getPosition={getPosition}
          getPressed={getPressed}
          onStrike={(pitch) => strike(pitch, 0.8)}
          onRelease={release}
        />
        {waiting ? (
          <p className="rise -translate-x-1/2 absolute top-6 left-1/2 rounded-full border border-accent/40 bg-panel/90 px-4 py-1.5 font-mono text-accent text-xs backdrop-blur">
            waiting for you
          </p>
        ) : null}
        {!soundReady ? (
          <p className="-translate-x-1/2 absolute bottom-6 left-1/2 flex items-center gap-2 rounded-full border border-line-strong bg-panel/90 px-4 py-1.5 text-muted text-xs backdrop-blur">
            <Volume2 className="size-3.5" aria-hidden="true" />
            press play to start the sound
          </p>
        ) : null}
      </div>

      <footer className="flex h-16 shrink-0 items-center gap-4 border-line border-t bg-panel px-4">
        <button
          type="button"
          onClick={() => void toggle()}
          data-tip={playing ? "Pause (space)" : "Play (space)"}
          data-tip-side="top"
          aria-label={playing ? "Pause" : "Play"}
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent text-void shadow-[0_0_24px_-6px_var(--accent)] transition-transform hover:scale-105 active:scale-95"
        >
          {playing ? (
            <Pause className="size-5 fill-current" aria-hidden="true" />
          ) : (
            <Play
              className="size-5 translate-x-px fill-current"
              aria-hidden="true"
            />
          )}
        </button>

        <span className="shrink-0 font-mono text-muted text-xs tabular-nums">
          {formatClock(elapsed)}
          <span className="text-faint"> / {formatClock(song.duration)}</span>
        </span>

        {mode === "battle" ? null : (
          <div className="shrink-0">
            <Popover
              label="Playback speed"
              align="left"
              side="top"
              trigger={(open) => (
                <span
                  data-tip="Slow it down to learn"
                  data-tip-side="top"
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-mono text-xs transition-colors ${
                    open || speed !== defaultSpeed
                      ? "border-accent text-accent"
                      : "border-line-strong text-muted hover:border-accent hover:text-accent"
                  }`}
                >
                  <Gauge className="size-3.5" aria-hidden="true" />
                  {speed}x
                </span>
              )}
            >
              <div className="w-28">
                {speeds.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => changeSpeed(option)}
                    aria-pressed={option === speed}
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2 font-mono text-sm transition-colors hover:bg-raised ${
                      option === speed ? "text-accent" : "text-muted"
                    }`}
                  >
                    {option}x
                    {option === defaultSpeed ? (
                      <span className="label">normal</span>
                    ) : null}
                  </button>
                ))}
              </div>
            </Popover>
          </div>
        )}

        <input
          type="range"
          min={0}
          max={Math.max(1, song.duration)}
          step={0.1}
          value={Math.min(elapsed, song.duration)}
          onChange={(event) => scrub(Number(event.target.value))}
          aria-label="Song position"
          className="h-1 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-line"
        />

        {interactive ? (
          <span className="hidden shrink-0 items-center gap-2 font-mono text-faint text-xs md:flex">
            <span data-tip="Arrow keys shift octave" data-tip-side="top">
              oct {octave}
            </span>
            <span className={midiReady ? "text-accent" : ""}>
              {midiReady ? "midi" : "keyboard"}
            </span>
          </span>
        ) : null}
      </footer>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-void text-muted">
      {children}
    </div>
  );
}
