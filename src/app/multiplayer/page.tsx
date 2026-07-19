import { MissingSong } from "@/components/missing-song";
import { Multiplayer } from "@/components/multiplayer";
import { iceServers } from "@/lib/multiplayer/ice";
import { parsePlayerParams } from "@/lib/player-url";
import { type RouteSearchParams, toSearchParams } from "@/lib/search-params";
import { config } from "@/server/config";

export default async function MultiplayerPage({
  searchParams,
}: {
  searchParams: Promise<RouteSearchParams>;
}) {
  const query = toSearchParams(await searchParams);
  const params = parsePlayerParams(query);
  const joinCode = query.get("join");
  if (params === null && joinCode === null) {
    return <MissingSong />;
  }
  return (
    <Multiplayer
      params={params}
      playerName={query.get("player") ?? "Player"}
      joinCode={joinCode}
      ice={iceServers(
        config.turnUrl,
        config.turnUsername,
        config.turnCredential,
      )}
    />
  );
}
