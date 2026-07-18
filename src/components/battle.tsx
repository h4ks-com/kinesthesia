"use client";

import type { DataConnection } from "peerjs";
import { useCallback, useEffect, useRef, useState } from "react";
import { BattleInvite } from "@/components/battle-invite";
import { OpponentView } from "@/components/opponent-view";
import { Player } from "@/components/player";
import type { IceServer } from "@/lib/battle/ice";
import {
  type BattleMessage,
  isBattleMessage,
  noOpponent,
  type Opponent,
} from "@/lib/battle/protocol";
import {
  clampMelodyRate,
  defaultMelodyRate,
  type MelodyRate,
} from "@/lib/midi/melody";
import { useSong } from "@/lib/midi/use-song";
import { type PlayerParams, parsePlayerParams } from "@/lib/player-url";
import { accuracy, type Score, scorePoints } from "@/lib/scoring/judge";

type Connection =
  | { status: "setup" }
  | { status: "opening" }
  | { status: "waiting"; link: string }
  | { status: "joining" }
  | { status: "failed"; message: string }
  | { status: "connected" };

type BattleProps = {
  params: PlayerParams;
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
  peerId: string;
  url: string;
  name: string;
  source: string | null;
  tracks: number[];
  simplified: boolean;
  melodyRate: number;
};

/** The player keeps the URL in step with the settings, so the address bar is
 * what a room is opened with and what an invite link carries. */
function settingsFromUrl(fallback: PlayerParams): PlayerParams {
  return (
    parsePlayerParams(new URLSearchParams(window.location.search)) ?? fallback
  );
}

export function Battle({ params, playerName, ice, joinCode }: BattleProps) {
  const [connection, setConnection] = useState<Connection>(
    joinCode === null ? { status: "setup" } : { status: "joining" },
  );
  const [opponent, setOpponent] = useState<Opponent | null>(null);
  const [agreed, setAgreed] = useState<PlayerParams | null>(null);
  const [copied, setCopied] = useState(false);
  const [theirPart, setTheirPart] = useState<OpponentPart | null>(null);
  const opponentKeys = useRef<Set<number>>(new Set());
  const match = agreed ?? params;
  const song = useSong(match);
  const linkRef = useRef<DataConnection | null>(null);

  const attach = useCallback(
    (link: DataConnection) => {
      linkRef.current = link;
      link.on("open", () => {
        setConnection({ status: "connected" });
        const mine = settingsFromUrl(params);
        link.send({
          kind: "hello",
          name: playerName,
          simplified: mine.simplified,
          melodyRate: mine.melodyRate,
          tracks: mine.tracks ?? [],
        } satisfies BattleMessage);
      });
      link.on("data", (raw) => {
        if (!isBattleMessage(raw)) {
          return;
        }
        if (raw.kind === "hello") {
          setOpponent({ ...noOpponent, name: raw.name });
          setTheirPart({
            simplified: raw.simplified ?? false,
            melodyRate: clampMelodyRate(raw.melodyRate ?? defaultMelodyRate),
            tracks: raw.tracks ?? [],
          });
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
    [playerName, params],
  );

  async function invite() {
    setConnection({ status: "opening" });
    const settings = settingsFromUrl(params);
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
          url: settings.url,
          name: settings.name,
          source: settings.source,
          tracks: settings.tracks ?? [],
          simplified: settings.simplified,
          melodyRate: settings.melodyRate,
        }),
      });
      if (!response.ok) {
        setConnection({ status: "failed", message: "Could not open a room" });
        return;
      }
      const room: { code: string } = await response.json();
      const invitation = new URL(window.location.href);
      invitation.searchParams.set("join", room.code);
      const link = invitation.toString();
      setConnection({ status: "waiting", link });
      void copy(link);
    });
    peer.on("connection", attach);
  }

  const joinRoom = useCallback(
    async (code: string) => {
      const response = await fetch(`/api/battle/rooms/${code}`);
      if (!response.ok) {
        setConnection({
          status: "failed",
          message: "That invite has expired",
        });
        return;
      }
      const room: RoomReply = await response.json();
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
    },
    [attach, ice, params],
  );

  useEffect(() => {
    if (joinCode !== null) {
      void joinRoom(joinCode);
    }
  }, [joinCode, joinRoom]);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
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

  const live = connection.status === "connected";
  // Once the room carries the settings, changing them here would hand the
  // other player a different part from the one they accepted.
  const settled =
    connection.status !== "setup" && connection.status !== "failed";

  return (
    <div className="flex h-dvh flex-col lg:flex-row">
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <Player
          mode="battle"
          params={match}
          onScore={onScore}
          onPress={onPress}
          onRelease={onRelease}
          opponent={null}
          locked={settled}
        />
        {live ? null : (
          <BattleInvite
            state={connection.status === "failed" ? "setup" : connection.status}
            link={connection.status === "waiting" ? connection.link : null}
            copied={copied}
            onInvite={() => void invite()}
            onCopy={() =>
              connection.status === "waiting" && void copy(connection.link)
            }
          />
        )}
        {connection.status === "failed" ? (
          <p className="-translate-x-1/2 absolute top-16 left-1/2 z-40 rounded-full border border-danger/40 bg-panel/95 px-3 py-1.5 text-danger text-xs backdrop-blur">
            {connection.message}
          </p>
        ) : null}
      </div>

      {live && song.status === "ready" ? (
        <OpponentView
          song={song.song}
          hiddenTracks={new Set()}
          opponent={opponent ?? noOpponent}
          part={theirPart}
          pressed={opponentPressed}
          connected={live}
        />
      ) : null}
    </div>
  );
}
