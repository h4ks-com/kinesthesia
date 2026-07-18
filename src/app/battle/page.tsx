import { Battle } from "@/components/battle";
import { MissingSong } from "@/components/missing-song";
import { iceServers } from "@/lib/battle/ice";
import { parsePlayerParams } from "@/lib/player-url";
import { type RouteSearchParams, toSearchParams } from "@/lib/search-params";
import { config } from "@/server/config";

export default async function BattlePage({
  searchParams,
}: {
  searchParams: Promise<RouteSearchParams>;
}) {
  const query = toSearchParams(await searchParams);
  const params = parsePlayerParams(query);
  if (params === null) {
    return <MissingSong />;
  }
  return (
    <Battle
      params={params}
      playerName={query.get("player") ?? "Player"}
      ice={iceServers(
        config.turnUrl,
        config.turnUsername,
        config.turnCredential,
      )}
    />
  );
}
