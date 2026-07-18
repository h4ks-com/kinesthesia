"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PianoRollView } from "@/components/piano-roll-view";
import { TrackMenu } from "@/components/track-menu";
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
  type PlayerMode,
  type PlayerParams,
} from "@/lib/player-url";
import {
  accuracy,
  applyJudgement,
  emptyScore,
  judge,
  type Score,
  scorePoints,
} from "@/lib/scoring/judge";

const chordWindow = 0.03;

type LoadState =
  | { status: "loading" }
  | { status: "failed"; message: string }
  | { status: "ready"; song: Song };

type Gate = {
  readonly start: number;
  readonly pitches: readonly number[];
};

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
  const song = load.status === "ready" ? load.song : null;

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: "loading" });
    loadSong(params.url, params.name)
      .then((loaded) => {
        if (!cancelled) {
          setLoad({ status: "ready", song: loaded });
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
  }, [params.url, params.name]);

  useEffect(() => {
    if (song === null || !interactive || playerTracks.size > 0) {
      return;
    }
    setPlayerTracks(new Set([defaultPlayerTrack(song)]));
  }, [song, interactive, playerTracks.size]);

  const autoTracks = useMemo(() => {
    if (song === null) {
      return new Set<number>();
    }
    const all = song.tracks.map((track) => track.index);
    return new Set(
      all.filter(
        (index) =>
          !hiddenTracks.has(index) && !(interactive && playerTracks.has(index)),
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
    void engine.ready();
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, [song]);

  useEffect(() => {
    engineRef.current?.setAutoTracks(autoTracks);
  }, [autoTracks]);

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
      setElapsed(engineRef.current?.position ?? 0);
    }, 100);
    return () => clearInterval(timer);
  }, []);

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
      engine.strike(pitch, velocity);
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
    [interactive, openGate],
  );

  const release = useCallback((pitch: number) => {
    pressedRef.current.delete(pitch);
  }, []);

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
      if (engine.position >= gate.start && pendingRef.current.size > 0) {
        engine.pause();
        setWaiting(true);
      }
    }, 16);
    return () => clearInterval(timer);
  }, [interactive]);

  async function toggle() {
    const engine = engineRef.current;
    if (engine === null) {
      return;
    }
    if (engine.playing) {
      engine.pause();
      setPlaying(false);
      return;
    }
    await engine.play();
    setPlaying(true);
  }

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

  useEffect(() => {
    const onSpace = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        event.preventDefault();
        void toggle();
      }
    };
    window.addEventListener("keydown", onSpace);
    return () => window.removeEventListener("keydown", onSpace);
  });

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

  const otherModes: PlayerMode[] =
    mode === "battle"
      ? []
      : (["watch", "play", "battle"] as const).filter((m) => m !== mode);

  return (
    <div className="flex min-h-dvh flex-col bg-[#05060a] text-zinc-100">
      <header className="flex flex-wrap items-center gap-3 border-zinc-800 border-b px-5 py-3">
        <Link href="/" className="font-semibold text-sm hover:underline">
          Kinesthesia
        </Link>
        <span className="truncate font-medium">{params.name}</span>
        <span className="text-xs text-zinc-500 uppercase">{mode}</span>

        <div className="ml-auto flex items-center gap-2">
          {interactive ? (
            <span className="text-sm text-zinc-400">
              {scorePoints(score)} pts · {Math.round(accuracy(score) * 100)}% ·{" "}
              {score.combo}x
            </span>
          ) : null}
          {opponent != null ? (
            <span className="rounded-md bg-zinc-800 px-2 py-1 text-sm">
              {opponent.name}: {opponent.points} pts ·{" "}
              {Math.round(opponent.accuracy * 100)}%
            </span>
          ) : null}
          <TrackMenu
            tracks={song.tracks}
            hidden={hiddenTracks}
            mine={playerTracks}
            interactive={interactive}
            onToggleVisible={toggleTrack}
            onToggleMine={togglePlayerTrack}
          />
          {otherModes.map((target) => (
            <Link
              key={target}
              href={buildPlayerUrl("http://x", target, {
                ...params,
                tracks: [...playerTracks],
              }).replace("http://x", "")}
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm capitalize"
            >
              {target}
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
        />
        {waiting ? (
          <p className="-translate-x-1/2 absolute top-6 left-1/2 rounded-full bg-zinc-900/80 px-4 py-1.5 text-sm">
            Waiting for your note
          </p>
        ) : null}
      </div>

      <footer className="flex items-center gap-4 border-zinc-800 border-t px-5 py-3">
        <button
          type="button"
          onClick={() => void toggle()}
          className="rounded-lg bg-emerald-400 px-4 py-2 font-semibold text-black text-sm"
        >
          {playing ? "Pause" : "Play"}
        </button>
        <span className="w-24 shrink-0 text-sm text-zinc-400 tabular-nums">
          {formatClock(elapsed)} / {formatClock(song.duration)}
        </span>
        <input
          type="range"
          min={0}
          max={Math.max(1, song.duration)}
          step={0.1}
          value={Math.min(elapsed, song.duration)}
          onChange={(event) => scrub(Number(event.target.value))}
          aria-label="Song position"
          className="flex-1 accent-emerald-400"
        />
        {interactive ? (
          <span className="shrink-0 text-sm text-zinc-400">
            Octave {octave} ·{" "}
            {midiReady ? "MIDI device connected" : "Computer keyboard"}
          </span>
        ) : (
          <span className="shrink-0 text-sm text-zinc-500">
            Space to play or pause
          </span>
        )}
      </footer>
    </div>
  );
}

function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, "0")}`;
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#05060a] text-zinc-300">
      {children}
    </div>
  );
}
