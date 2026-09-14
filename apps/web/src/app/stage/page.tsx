import { StageStart } from "@/components/stage-start";
import { parsePlayerParams } from "@/lib/player-url";
import { type RouteSearchParams, toSearchParams } from "@/lib/search-params";
import { config } from "@/server/config";

/** A song is optional here: without one the stage still lays the real keys out
 * and lights what the player plays. */
export default async function StagePage({
  searchParams,
}: {
  searchParams: Promise<RouteSearchParams>;
}) {
  return (
    <StageStart
      params={parsePlayerParams(
        toSearchParams(await searchParams),
        config.trustedMidiOrigins,
      )}
    />
  );
}
