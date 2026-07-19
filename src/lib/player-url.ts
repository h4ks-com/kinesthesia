import {
  clampMelodyRate,
  defaultMelodyRate,
  type MelodyRate,
} from "@/lib/midi/melody";

export const playerModes = ["watch", "learn", "multiplayer"] as const;

export type PlayerMode = (typeof playerModes)[number];

export const speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5] as const;
export const defaultSpeed = 1;

export type Speed = (typeof speeds)[number];

export type PlayerParams = {
  readonly url: string;
  readonly name: string;
  readonly source: string | null;
  readonly tracks: readonly number[] | null;
  readonly speed: Speed;
  /** Reduces the part you owe to one note at a time. It rides in the URL so
   * both sides of a match play the identical line. */
  readonly simplified: boolean;
  readonly melodyRate: MelodyRate;
};

function isSpeed(value: number): value is Speed {
  return speeds.some((option) => option === value);
}

export function asSpeed(value: number): Speed {
  return isSpeed(value) ? value : defaultSpeed;
}

export type SongSettingKey = "speed" | "tracks" | "simplified" | "melodyRate";

/** A setting a link states outright wins over what the device remembers for
 * the tune, which is how a shared view reproduces itself. */
export function explicitSongSettings(
  searchParams: URLSearchParams,
): ReadonlySet<SongSettingKey> {
  const present = new Set<SongSettingKey>();
  if (searchParams.has("speed")) {
    present.add("speed");
  }
  if (searchParams.has("tracks")) {
    present.add("tracks");
  }
  if (searchParams.has("simple")) {
    present.add("simplified");
  }
  if (searchParams.has("rate")) {
    present.add("melodyRate");
  }
  return present;
}

function readRate(raw: string | null): MelodyRate {
  if (raw === null) {
    return defaultMelodyRate;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? clampMelodyRate(value) : defaultMelodyRate;
}

function isPlayableUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/** Explicit spells out every song setting even at its default, so a link
 * copied from a running player reproduces that exact view. A default left
 * implicit defers to whatever the recipient's device remembers. */
export function buildPlayerUrl(
  baseUrl: string,
  mode: PlayerMode,
  params: PlayerParams,
  options: { explicit?: boolean } = {},
): string {
  const explicit = options.explicit ?? false;
  const target = new URL(`/${mode}`, baseUrl);
  target.searchParams.set("url", params.url);
  target.searchParams.set("name", params.name);
  if (params.source !== null) {
    target.searchParams.set("source", params.source);
  }
  if (explicit || (params.tracks !== null && params.tracks.length > 0)) {
    target.searchParams.set("tracks", (params.tracks ?? []).join(","));
  }
  if (explicit || params.speed !== defaultSpeed) {
    target.searchParams.set("speed", String(params.speed));
  }
  if (explicit || params.simplified) {
    target.searchParams.set("simple", params.simplified ? "1" : "0");
  }
  if (explicit || params.melodyRate !== defaultMelodyRate) {
    target.searchParams.set("rate", String(params.melodyRate));
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

  const speed = Number(searchParams.get("speed"));

  return {
    url,
    name: searchParams.get("name") ?? "",
    source: searchParams.get("source"),
    tracks,
    speed: isSpeed(speed) ? speed : defaultSpeed,
    simplified: searchParams.get("simple") === "1",
    melodyRate: readRate(searchParams.get("rate")),
  };
}
