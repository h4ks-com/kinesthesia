"use client";

import type { DataConnection } from "peerjs";
import { useCallback, useEffect, useRef, useState } from "react";
import { BattleInvite } from "@/components/battle-invite";
import { OpponentView } from "@/components/opponent-view";
import { Player, type PlayerHandle } from "@/components/player";
import type { IceServer } from "@/lib/battle/ice";
import {
  type BattleMessage,
  battleOutcome,
  isBattleMessage,
  noOpponent,
  type Opponent,
  type Outcome,
} from "@/lib/battle/protocol";
import {
  clampMelodyRate,
  defaultMelodyRate,
  type MelodyRate,
} from "@/lib/midi/melody";
import { useSong } from "@/lib/midi/use-song";
import {
  asSpeed,
  type PlayerParams,
  parsePlayerParams,
} from "@/lib/player-url";
import { accuracy, type Score, scorePoints } from "@/lib/scoring/judge";
import { scoreSubmission } from "@/lib/scoring/submission";

type Connection =
  | { status: "setup" }
  | { status: "opening" }
  | { status: "waiting"; link: string }
  | { status: "joining" }
  | { status: "failed"; message: string }
  | { status: "connected" };

/** Play never pauses, so a connected match walks from ready, through a shared
 * countdown, to a result. */
type Phase = "ready" | "countdown" | "playing" | "result";

type BattleProps = {
  params: PlayerParams | null;
  playerName: string;
  ice: readonly IceServer[];
  joinCode: string | null;
};

type OpponentPart = {
  readonly simplified: boolean;
  readonly melodyRate: MelodyRate;
  readonly tracks: readonly number[];
};

type RoomReply = {
  readonly peerId: string;
  readonly url: string;
  readonly name: string;
  readonly source: string | null;
  readonly tracks: readonly number[];
  readonly speed: number;
  readonly simplified: boolean;
  readonly melodyRate: number;
};

function matchKey(match: PlayerParams): string {
  return [
    match.url,
    match.simplified,
    match.melodyRate,
    match.speed,
    (match.tracks ?? []).join(","),
  ].join("|");
}

/** The player publishes its settings to the URL, so the address bar is the
 * host's live truth for what a room carries. */
function settingsFromUrl(fallback: PlayerParams | null): PlayerParams | null {
  if (typeof window === "undefined") {
    return fallback;
  }
  return (
    parsePlayerParams(new URLSearchParams(window.location.search)) ?? fallback
  );
}

export function Battle({ params, playerName, ice, joinCode }: BattleProps) {
  const isHost = joinCode === null;
  const [connection, setConnection] = useState<Connection>(
    isHost ? { status: "setup" } : { status: "joining" },
  );
  const [opponent, setOpponent] = useState<Opponent | null>(null);
  const [agreed, setAgreed] = useState<PlayerParams | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "denied">(
    "idle",
  );
  const [theirPart, setTheirPart] = useState<OpponentPart | null>(null);
  const [roomOpen, setRoomOpen] = useState(joinCode !== null);

  const [phase, setPhase] = useState<Phase>("ready");
  const [round, setRound] = useState(0);
  const [count, setCount] = useState(3);
  const [myReady, setMyReady] = useState(false);
  const [theirReady, setTheirReady] = useState(false);
  const [myPoints, setMyPoints] = useState(0);
  const [myRematch, setMyRematch] = useState(false);
  const [theirRematch, setTheirRematch] = useState(false);
  const [opponentGone, setOpponentGone] = useState(false);

  const opponentKeys = useRef<Set<number>>(new Set());
  const match = agreed ?? params;
  const theirPoints = opponent?.points ?? 0;
  const opponentFinished = opponent?.finished === true;
  const song = useSong(match);
  const linkRef = useRef<DataConnection | null>(null);
  const peerRef = useRef<{ destroy: () => void } | null>(null);
  const playerRef = useRef<PlayerHandle | null>(null);
  const roomCodeRef = useRef<string | null>(null);
  const lastSeen = useRef(0);
  const myStats = useRef({ accuracy: 1, bestCombo: 0 });
  const joining = useRef(false);
  const agreedRef = useRef(agreed);
  agreedRef.current = agreed;
  const currentSettings = useCallback(
    (): PlayerParams | null => agreedRef.current ?? settingsFromUrl(params),
    [params],
  );

  const send = useCallback((message: BattleMessage): void => {
    linkRef.current?.send(message);
  }, []);

  /** The other side is gone: the match ends where it stands and its room is
   * already closed, so there is nothing to rejoin. */
  const opponentLeft = useCallback((): void => {
    setOpponentGone(true);
    setConnection((current) =>
      current.status === "connected"
        ? current
        : { status: "failed", message: "The other player left" },
    );
  }, []);

  const resetRound = useCallback((): void => {
    setMyPoints(0);
    setMyRematch(false);
    setTheirRematch(false);
    setOpponent((current) =>
      current === null ? current : { ...current, points: 0, finished: false },
    );
  }, []);

  const openRound = useCallback(
    (next: number): void => {
      resetRound();
      setRound(next);
      setCount(3);
      setPhase("countdown");
    },
    [resetRound],
  );

  const attach = useCallback(
    (link: DataConnection) => {
      // A room is for two, so a second connection racing the room close is
      // refused before it can hijack the match.
      if (linkRef.current?.open === true) {
        link.close();
        return;
      }
      linkRef.current = link;
      link.on("open", () => {
        lastSeen.current = Date.now();
        setConnection({ status: "connected" });
        const mine = currentSettings();
        link.send({
          kind: "hello",
          name: playerName,
          simplified: mine?.simplified ?? false,
          melodyRate: mine?.melodyRate ?? defaultMelodyRate,
          tracks: mine?.tracks ?? [],
        } satisfies BattleMessage);
      });
      link.on("data", (raw) => {
        if (!isBattleMessage(raw)) {
          return;
        }
        lastSeen.current = Date.now();
        if (raw.kind === "hello") {
          setOpponent({ ...noOpponent, name: raw.name });
          setTheirPart({
            simplified: raw.simplified ?? false,
            melodyRate: clampMelodyRate(raw.melodyRate ?? defaultMelodyRate),
            tracks: raw.tracks ?? [],
          });
        }
        if (raw.kind === "ready") {
          setTheirReady(true);
        }
        if (raw.kind === "begin") {
          openRound(raw.round);
        }
        if (raw.kind === "score") {
          setOpponent((current) => ({
            ...(current ?? noOpponent),
            points: raw.points,
            accuracy: raw.accuracy,
            combo: raw.score.combo,
            position: raw.position,
          }));
        }
        if (raw.kind === "press") {
          opponentKeys.current.add(raw.pitch);
        }
        if (raw.kind === "release") {
          opponentKeys.current.delete(raw.pitch);
        }
        if (raw.kind === "finished") {
          setOpponent((current) => ({
            ...(current ?? noOpponent),
            points: raw.points,
            finished: true,
          }));
        }
        if (raw.kind === "rematch") {
          setTheirRematch(true);
        }
      });
      link.on("close", () => opponentLeft());
      link.on("error", () => opponentLeft());
    },
    [playerName, currentSettings, openRound, opponentLeft],
  );

  async function ready(): Promise<void> {
    // A failure to unlock audio must not swallow the handshake, or the other
    // side waits forever; the round still begins and simply plays quiet.
    try {
      await playerRef.current?.prepare();
    } catch {}
    setMyReady(true);
    send({ kind: "ready" });
  }

  function rematch(): void {
    setMyRematch(true);
    send({ kind: "rematch" });
  }

  useEffect(() => {
    if (connection.status !== "connected" || opponentGone) {
      return;
    }
    const id = setInterval(() => {
      send({ kind: "ping" });
      if (Date.now() - lastSeen.current > 4000) {
        opponentLeft();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [connection.status, opponentGone, send, opponentLeft]);

  // Only the host starts a round, so both sides run off one clock.
  useEffect(() => {
    if (!isHost || connection.status !== "connected") {
      return;
    }
    if (phase === "ready" && myReady && theirReady && !opponentGone) {
      send({ kind: "begin", round: 1 });
      openRound(1);
    }
    if (phase === "result" && myRematch && theirRematch && !opponentGone) {
      send({ kind: "begin", round: round + 1 });
      openRound(round + 1);
    }
  }, [
    isHost,
    connection.status,
    phase,
    myReady,
    theirReady,
    myRematch,
    theirRematch,
    opponentGone,
    round,
    send,
    openRound,
  ]);

  useEffect(() => {
    if (phase !== "countdown" || opponentGone) {
      return;
    }
    let n = 3;
    const id = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        clearInterval(id);
        playerRef.current?.startRound();
        setPhase("playing");
      } else {
        setCount(n);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [phase, opponentGone]);

  // A departure ends the round where it stands, so no one is left playing alone.
  useEffect(() => {
    if (opponentGone && (phase === "countdown" || phase === "playing")) {
      playerRef.current?.stop();
      setPhase("result");
    }
  }, [opponentGone, phase]);

  const onEnd = useCallback(
    (score: Score): void => {
      const points = scorePoints(score);
      setMyPoints(points);
      myStats.current = {
        accuracy: accuracy(score),
        bestCombo: score.bestCombo,
      };
      send({ kind: "finished", points });
      setPhase("result");
    },
    [send],
  );

  const recordedRound = useRef(-1);
  useEffect(() => {
    if (
      phase !== "result" ||
      match === null ||
      recordedRound.current === round
    ) {
      return;
    }
    const settled = opponentGone || opponentFinished;
    if (!settled) {
      return;
    }
    recordedRound.current = round;
    const outcome: Outcome = opponentGone
      ? "win"
      : battleOutcome(myPoints, theirPoints);
    void fetch("/api/scores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...scoreSubmission(match, "battle", {
          points: myPoints,
          accuracy: myStats.current.accuracy,
          bestCombo: myStats.current.bestCombo,
        }),
        outcome,
        opponentPoints: theirPoints,
      }),
    }).catch(() => {});
  }, [
    phase,
    round,
    match,
    opponentGone,
    opponentFinished,
    theirPoints,
    myPoints,
  ]);

  const joinRoom = useCallback(
    async (code: string) => {
      const response = await fetch(`/api/battle/rooms/${code}`);
      if (!response.ok) {
        setConnection({ status: "failed", message: "That invite has expired" });
        return;
      }
      const room: RoomReply = await response.json();
      setAgreed({
        url: room.url,
        name: room.name,
        source: room.source,
        tracks: room.tracks,
        speed: asSpeed(room.speed),
        simplified: room.simplified,
        melodyRate: clampMelodyRate(room.melodyRate),
      });
      const { Peer } = await import("peerjs");
      peerRef.current?.destroy();
      const peer = new Peer({ config: { iceServers: [...ice] } });
      peerRef.current = peer;
      peer.on("error", (error) =>
        setConnection({ status: "failed", message: error.message }),
      );
      peer.on("open", () => attach(peer.connect(room.peerId)));
    },
    [attach, ice],
  );

  async function invite(): Promise<void> {
    const settings = currentSettings();
    if (settings === null) {
      return;
    }
    setConnection({ status: "opening" });
    const { Peer } = await import("peerjs");
    peerRef.current?.destroy();
    const peer = new Peer({ config: { iceServers: [...ice] } });
    peerRef.current = peer;
    peer.on("error", (error) =>
      setConnection({ status: "failed", message: error.message }),
    );
    peer.on("open", async (peerId) => {
      const response = await fetch("/api/battle/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          peerId,
          url: settings.url,
          name: settings.name,
          source: settings.source,
          tracks: settings.tracks ?? [],
          speed: settings.speed,
          simplified: settings.simplified,
          melodyRate: settings.melodyRate,
        }),
      });
      if (!response.ok) {
        setConnection({ status: "failed", message: "Could not open a room" });
        return;
      }
      const room: { code: string } = await response.json();
      roomCodeRef.current = room.code;
      const invitation = new URL("/battle", window.location.origin);
      invitation.searchParams.set("join", room.code);
      const link = invitation.toString();
      setRoomOpen(true);
      setConnection({ status: "waiting", link });
      void copy(link);
    });
    peer.on("connection", (link) => {
      // The invite is single use, so the room closes the moment a player joins.
      if (roomCodeRef.current !== null) {
        void fetch(`/api/battle/rooms/${roomCodeRef.current}`, {
          method: "DELETE",
        }).catch(() => {});
      }
      attach(link);
    });
  }

  useEffect(() => {
    if (joinCode !== null && !joining.current) {
      joining.current = true;
      void joinRoom(joinCode);
    }
  }, [joinCode, joinRoom]);

  useEffect(
    () => () => {
      linkRef.current?.close();
      peerRef.current?.destroy();
    },
    [],
  );

  async function copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
    } catch {
      setCopyState("denied");
    }
  }

  const onScore = useCallback((score: Score, position: number) => {
    linkRef.current?.send({
      kind: "score",
      score,
      points: scorePoints(score),
      accuracy: accuracy(score),
      position,
    } satisfies BattleMessage);
  }, []);

  const onPress = useCallback((pitch: number) => {
    linkRef.current?.send({ kind: "press", pitch } satisfies BattleMessage);
  }, []);

  const onRelease = useCallback((pitch: number) => {
    linkRef.current?.send({ kind: "release", pitch } satisfies BattleMessage);
  }, []);

  const opponentPressed = useCallback(
    () => opponentKeys.current as ReadonlySet<number>,
    [],
  );

  const live = connection.status === "connected";
  const settled = roomOpen || connection.status === "opening";
  const announcement = opponentGone
    ? "The other player left"
    : phase === "result" && opponentFinished
      ? `${outcomeTitle(myPoints, theirPoints)}. You ${myPoints}, them ${theirPoints}.`
      : "";

  return (
    <div className="flex h-dvh flex-col lg:flex-row">
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {match === null ? (
          <div className="flex flex-1 items-center justify-center bg-void" />
        ) : (
          <Player
            ref={playerRef}
            key={matchKey(match)}
            mode="battle"
            params={match}
            onScore={onScore}
            onPress={onPress}
            onRelease={onRelease}
            opponent={null}
            locked={settled}
            matchActive={live}
            onEnd={onEnd}
          />
        )}

        {live ? null : (
          <BattleInvite
            connection={connection}
            copyState={copyState}
            onInvite={() => {
              if (isHost) {
                void invite();
                return;
              }
              joining.current = false;
              setConnection({ status: "joining" });
              void joinRoom(joinCode);
            }}
            onCopy={() => {
              if (connection.status === "waiting") {
                void copy(connection.link);
              }
            }}
          />
        )}

        {live ? (
          <MatchOverlay
            phase={phase}
            count={count}
            songReady={song.status === "ready"}
            myReady={myReady}
            myPoints={myPoints}
            theirPoints={theirPoints}
            opponentReady={theirReady}
            opponentDone={opponentFinished}
            opponentGone={opponentGone}
            myRematch={myRematch}
            onReady={() => void ready()}
            onRematch={rematch}
          />
        ) : null}
      </div>

      {song.status === "ready" ? (
        <OpponentView
          song={song.song}
          hiddenTracks={new Set()}
          opponent={opponent ?? noOpponent}
          part={theirPart}
          pressed={opponentPressed}
          state={live ? "playing" : opponent !== null ? "gone" : "waiting"}
        />
      ) : (
        <section className="flex min-h-0 min-w-0 flex-1 items-center justify-center border-line bg-void text-muted text-sm max-lg:border-t lg:border-l">
          waiting for a player
        </section>
      )}
    </div>
  );
}

type MatchOverlayProps = {
  phase: Phase;
  count: number;
  songReady: boolean;
  myReady: boolean;
  myPoints: number;
  theirPoints: number;
  opponentReady: boolean;
  opponentDone: boolean;
  opponentGone: boolean;
  myRematch: boolean;
  onReady: () => void;
  onRematch: () => void;
};

function MatchOverlay({
  phase,
  count,
  songReady,
  myReady,
  myPoints,
  theirPoints,
  opponentReady,
  opponentDone,
  opponentGone,
  myRematch,
  onReady,
  onRematch,
}: MatchOverlayProps) {
  // A departure ends the match in any phase, so it is checked before play hides
  // the overlay, and the only way on is out.
  if (opponentGone) {
    return (
      <Scrim label="The other player left">
        <div className="flex flex-col items-center gap-4">
          <h2 className="font-bold text-3xl">The other player left</h2>
          <LeaveLink />
        </div>
      </Scrim>
    );
  }

  if (phase === "playing") {
    return null;
  }

  if (phase === "countdown") {
    return (
      <Scrim label={`Starting in ${count}`}>
        <span
          className="font-bold text-7xl text-accent tabular-nums"
          aria-hidden="true"
        >
          {count}
        </span>
      </Scrim>
    );
  }

  if (phase === "ready") {
    return (
      <Scrim label="Get ready">
        <div className="flex flex-col items-center gap-4">
          {myReady ? (
            <p className="text-muted text-sm">
              {opponentReady ? "Starting…" : "Waiting for the other player"}
            </p>
          ) : songReady ? (
            <button
              type="button"
              onClick={onReady}
              className="rounded-full bg-accent px-6 py-3 font-semibold text-void transition-colors hover:bg-accent-glow"
            >
              Ready
            </button>
          ) : (
            <p className="text-muted text-sm">Loading the song</p>
          )}
          <LeaveLink />
        </div>
      </Scrim>
    );
  }

  return (
    <Scrim label="Match result">
      <div className="flex flex-col items-center gap-4">
        {opponentDone ? (
          <h2 className="font-bold text-3xl">
            {outcomeTitle(myPoints, theirPoints)}
          </h2>
        ) : (
          <p className="text-muted text-sm">
            Waiting for the other player to finish
          </p>
        )}
        <p className="font-mono text-muted text-sm tabular-nums">
          you {myPoints} · them {theirPoints}
        </p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onRematch}
            disabled={myRematch}
            className="rounded-full bg-accent px-5 py-2.5 font-semibold text-void transition-colors hover:bg-accent-glow disabled:opacity-60"
          >
            {myRematch ? "Waiting…" : "Rematch"}
          </button>
          <LeaveLink />
        </div>
      </div>
    </Scrim>
  );
}

function outcomeTitle(mine: number, theirs: number): string {
  const outcome = battleOutcome(mine, theirs);
  return outcome === "win"
    ? "You win"
    : outcome === "loss"
      ? "You lose"
      : "A draw";
}

function LeaveLink() {
  return (
    <a
      href="/"
      className="rounded-full border border-line-strong px-5 py-2.5 font-medium text-sm transition-colors hover:border-accent hover:text-accent"
    >
      Leave
    </a>
  );
}

function Scrim({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="dialog"
      aria-label={label}
      className="absolute inset-0 z-40 flex items-center justify-center bg-void/70 backdrop-blur-sm"
    >
      {children}
    </div>
  );
}
