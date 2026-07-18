"use client";

import { Check, Copy } from "lucide-react";
import Link from "next/link";
import type { DataConnection } from "peerjs";
import { useCallback, useEffect, useRef, useState } from "react";
import { OpponentView } from "@/components/opponent-view";
import { Player } from "@/components/player";
import type { IceServer } from "@/lib/battle/ice";
import {
  type BattleMessage,
  isBattleMessage,
  noOpponent,
  type Opponent,
} from "@/lib/battle/protocol";
import { clampMelodyRate } from "@/lib/midi/melody";
import { useSong } from "@/lib/midi/use-song";
import type { PlayerParams } from "@/lib/player-url";
import { accuracy, type Score, scorePoints } from "@/lib/scoring/judge";

type Connection =
  | { status: "idle" }
  | { status: "hosting"; code: string }
  | { status: "joining" }
  | { status: "failed"; message: string }
  | { status: "connected" };

type BattleProps = {
  params: PlayerParams;
  playerName: string;
  ice: readonly IceServer[];
};

export function Battle({ params, playerName, ice }: BattleProps) {
  const [connection, setConnection] = useState<Connection>({ status: "idle" });
  const [opponent, setOpponent] = useState<Opponent | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [agreed, setAgreed] = useState<PlayerParams | null>(null);
  const [copied, setCopied] = useState(false);
  const opponentKeys = useRef<Set<number>>(new Set());
  const match = agreed ?? params;
  const song = useSong(match);
  const linkRef = useRef<DataConnection | null>(null);

  const attach = useCallback(
    (link: DataConnection) => {
      linkRef.current = link;
      link.on("open", () => {
        setConnection({ status: "connected" });
        link.send({ kind: "hello", name: playerName } satisfies BattleMessage);
      });
      link.on("data", (raw) => {
        if (!isBattleMessage(raw)) {
          return;
        }
        if (raw.kind === "hello") {
          setOpponent({ ...noOpponent, name: raw.name });
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
      });
      link.on("close", () =>
        setConnection({ status: "failed", message: "The other player left" }),
      );
      link.on("error", () =>
        setConnection({ status: "failed", message: "The connection dropped" }),
      );
    },
    [playerName],
  );

  async function host() {
    setConnection({ status: "joining" });
    const { Peer } = await import("peerjs");
    const peer = new Peer({ config: { iceServers: [...ice] } });
    peer.on("error", (error) =>
      setConnection({ status: "failed", message: error.message }),
    );
    peer.on("open", async (peerId) => {
      const response = await fetch("/api/battle/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          peerId,
          url: params.url,
          name: params.name,
          source: params.source,
          tracks: params.tracks ?? [],
          simplified: params.simplified,
          melodyRate: params.melodyRate,
        }),
      });
      if (!response.ok) {
        setConnection({ status: "failed", message: "Could not open a room" });
        return;
      }
      const room: { code: string } = await response.json();
      setConnection({ status: "hosting", code: room.code });
      void copyCode(room.code);
    });
    peer.on("connection", attach);
  }

  async function join() {
    const code = joinCode.trim().toUpperCase();
    if (code.length !== 5) {
      return;
    }
    setConnection({ status: "joining" });
    const response = await fetch(`/api/battle/rooms/${code}`);
    if (!response.ok) {
      setConnection({ status: "failed", message: "That room is not open" });
      return;
    }
    const room: {
      peerId: string;
      url: string;
      name: string;
      source: string | null;
      tracks: number[];
      simplified: boolean;
      melodyRate: number;
    } = await response.json();
    setAgreed({
      ...params,
      url: room.url,
      name: room.name,
      source: room.source,
      tracks: room.tracks,
      simplified: room.simplified,
      melodyRate: clampMelodyRate(room.melodyRate),
    });
    const { Peer } = await import("peerjs");
    const peer = new Peer({ config: { iceServers: [...ice] } });
    peer.on("error", (error) =>
      setConnection({ status: "failed", message: error.message }),
    );
    peer.on("open", () => attach(peer.connect(room.peerId)));
  }

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setCopied(false);
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

  useEffect(() => () => linkRef.current?.close(), []);

  if (connection.status === "connected" || connection.status === "failed") {
    if (song.status === "ready") {
      return (
        <div className="flex h-dvh flex-col lg:flex-row">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <Player
              mode="battle"
              params={match}
              onScore={onScore}
              onPress={onPress}
              onRelease={onRelease}
              opponent={null}
            />
          </div>
          <OpponentView
            song={song.song}
            hiddenTracks={new Set()}
            opponent={opponent ?? noOpponent}
            pressed={opponentPressed}
            connected={connection.status === "connected"}
          />
        </div>
      );
    }
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-[#05060a] px-6 text-zinc-100">
      <div className="flex flex-col items-center gap-1">
        <h1 className="font-semibold text-2xl">Battle</h1>
        <p className="text-zinc-400">{match.name}</p>
      </div>

      {connection.status === "hosting" ? (
        <div className="flex flex-col items-center gap-2">
          <p className="text-zinc-400 text-sm">
            Give this code to your opponent
          </p>
          <button
            type="button"
            onClick={() => void copyCode(connection.code)}
            data-tip={copied ? "Copied" : "Copy the code"}
            aria-label={`Copy room code ${connection.code}`}
            className="flex items-center gap-3 rounded-xl border border-line-strong px-5 py-3 font-mono text-4xl tracking-[0.3em] transition-colors hover:border-accent hover:text-accent"
          >
            {connection.code}
            {copied ? (
              <Check className="size-5 text-accent" aria-hidden="true" />
            ) : (
              <Copy className="size-5 text-faint" aria-hidden="true" />
            )}
          </button>
          <p className="text-muted text-sm">
            {copied ? "Copied, send it over" : "Waiting for them to join"}
          </p>
        </div>
      ) : null}

      {connection.status === "joining" ? (
        <p className="text-zinc-400">Connecting</p>
      ) : null}

      {connection.status === "failed" ? (
        <p className="text-red-400">{connection.message}</p>
      ) : null}

      {connection.status === "idle" || connection.status === "failed" ? (
        <div className="flex w-full max-w-sm flex-col gap-4">
          <button
            type="button"
            onClick={() => void host()}
            className="rounded-lg bg-emerald-400 px-4 py-2.5 font-semibold text-black"
          >
            Open a room
          </button>
          <div className="flex gap-2">
            <input
              value={joinCode}
              onChange={(event) =>
                setJoinCode(event.target.value.toUpperCase())
              }
              placeholder="Room code"
              aria-label="Room code"
              maxLength={5}
              className="flex-1 rounded-lg border border-zinc-700 bg-transparent px-4 py-2.5 font-mono uppercase tracking-widest outline-none focus:border-zinc-500"
            />
            <button
              type="button"
              onClick={() => void join()}
              className="rounded-lg border border-zinc-700 px-4 py-2.5 font-medium"
            >
              Join
            </button>
          </div>
        </div>
      ) : null}

      <Link href="/" className="text-sm text-zinc-500 hover:underline">
        Back to search
      </Link>
    </main>
  );
}
