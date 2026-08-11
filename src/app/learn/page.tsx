import { MissingSong } from "@/components/missing-song";
import { Player } from "@/components/player";
import { parsePlayerParams } from "@/lib/player-url";
import { type RouteSearchParams, toSearchParams } from "@/lib/search-params";
import { currentViewer } from "@/server/auth";
import { config } from "@/server/config";
import { bucketEnabled } from "@/server/storage/bucket";

export default async function LearnPage({
  searchParams,
}: {
  searchParams: Promise<RouteSearchParams>;
}) {
  const params = parsePlayerParams(
    toSearchParams(await searchParams),
    config.trustedMidiOrigins,
  );
  if (params === null) {
    return <MissingSong />;
  }
  const viewer = await currentViewer();
  return (
    <Player
      mode="learn"
      params={params}
      viewerId={viewer?.id ?? null}
      shareEnabled={bucketEnabled()}
    />
  );
}
