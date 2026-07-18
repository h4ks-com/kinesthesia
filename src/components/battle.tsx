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
import {
  asSpeed,
  type PlayerParams,
  parsePlayerParams,
} from "@/lib/player-url";
import { accuracy, type Score, scorePoints } from "@/lib/scoring/judge";

type Connection =
  | { status: "setup" }
  | { status: "opening" }
  | { status: "waiting"; link: string }
  | { status: "joining" }
  | { status: "failed"; message: string }
  | { status: "connected" };

type BattleProps = {
  params: PlayerParams | null;
  playerName: string;
  ice: readonly IceServer[];
  joinCode: string | null;
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
  const [connection, setConnection] = useState<Connection>(
    joinCode === null ? { status: "setup" } : { status: "joining" },
  );
  const [opponent, setOpponent] = useState<Opponent | null>(null);
  const [agreed, setAgreed] = useState<PlayerParams | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "denied">(
    "idle",
  );
  const [theirPart, setTheirPart] = useState<OpponentPart | null>(null);
  const [roomOpen, setRoomOpen] = useState(joinCode !== null);
  const opponentKeys = useRef<Set<number>>(new Set());
  const match = agreed ?? params;
  const song = useSong(match);
  const linkRef = useRef<DataConnection | null>(null);
  const peerRef = useRef<{ destroy: () => void } | null>(null);
  const joining = useRef(false);
  // The player publishes to the URL without re-rendering this component, so a
  // closed-over render value goes stale; this reads the URL fresh each time.
  const agreedRef = useRef(agreed);
  agreedRef.current = agreed;
  const currentSettings = useCallback(
    (): PlayerParams | null => agreedRef.current ?? settingsFromUrl(params),
    [params],
  );

  const attach = useCallback(
    (link: DataConnection) => {
      linkRef.current = link;
      link.on("open", () => {
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
    [playerName, currentSettings],
  );

  async function invite() {
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
      // The room holds the whole match, so the link stays short enough to send
      // in a chat or read aloud.
      const invitation = new URL("/battle", window.location.origin);
      invitation.searchParams.set("join", room.code);
      const link = invitation.toString();
      setRoomOpen(true);
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

  async function copy(text: string) {
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
  // A room outlives the connection that drops, and its invite link is already
  // out, so once one is open the settings stay frozen even between attempts.
  const settled = roomOpen || connection.status === "opening";

  return (
    <div className="flex h-dvh flex-col lg:flex-row">
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {match === null ? (
          <div className="flex flex-1 items-center justify-center bg-void" />
        ) : (
          <Player
            key={matchKey(match)}
            mode="battle"
            params={match}
            onScore={onScore}
            onPress={onPress}
            onRelease={onRelease}
            opponent={null}
            locked={settled}
          />
        )}
        {live ? null : (
          <BattleInvite
            connection={connection}
            copyState={copyState}
            onInvite={() => {
              if (joinCode === null) {
                void invite();
                return;
              }
              // A join link carries no settings, so a retry rejoins the room it
              // already points at.
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
