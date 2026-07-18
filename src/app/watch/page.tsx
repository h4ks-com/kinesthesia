import { MissingSong } from "@/components/missing-song";
import { Player } from "@/components/player";
import { parsePlayerParams } from "@/lib/player-url";
import { type RouteSearchParams, toSearchParams } from "@/lib/search-params";

export default async function WatchPage({
  searchParams,
}: {
  searchParams: Promise<RouteSearchParams>;
}) {
  const params = parsePlayerParams(toSearchParams(await searchParams));
  if (params === null) {
    return <MissingSong />;
  }
  return <Player mode="watch" params={params} />;
}
