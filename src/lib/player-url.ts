export const playerModes = ["watch", "play", "battle"] as const;

export type PlayerMode = (typeof playerModes)[number];

export type PlayerParams = {
  readonly url: string;
  readonly name: string;
  readonly source: string | null;
  readonly tracks: readonly number[] | null;
};

function isPlayableUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

export function buildPlayerUrl(
  baseUrl: string,
  mode: PlayerMode,
  params: PlayerParams,
): string {
  const target = new URL(`/${mode}`, baseUrl);
  target.searchParams.set("url", params.url);
  target.searchParams.set("name", params.name);
  if (params.source !== null) {
    target.searchParams.set("source", params.source);
  }
  if (params.tracks !== null && params.tracks.length > 0) {
    target.searchParams.set("tracks", params.tracks.join(","));
  }
  return target.toString();
}

const localBase = "http://player.local";

export function playerPath(mode: PlayerMode, params: PlayerParams): string {
  return buildPlayerUrl(localBase, mode, params).slice(localBase.length);
}

/** Returns null when the url is absent or not http(s), which keeps a crafted
 * `javascript:` link from ever reaching an audio loader or an anchor. */
export function parsePlayerParams(
  searchParams: URLSearchParams,
): PlayerParams | null {
  const url = searchParams.get("url");
  if (url === null || !isPlayableUrl(url)) {
    return null;
  }
  const rawTracks = searchParams.get("tracks");
  const tracks =
    rawTracks === null
      ? null
      : rawTracks
          .split(",")
          .map((value) => Number.parseInt(value, 10))
          .filter((value) => Number.isInteger(value) && value >= 0);

  return {
    url,
    name: searchParams.get("name") ?? "",
    source: searchParams.get("source"),
    tracks,
  };
}
