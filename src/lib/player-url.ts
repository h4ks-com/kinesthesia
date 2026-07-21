import {
  clampMelodyRate,
  defaultMelodyRate,
  type MelodyRate,
} from "@/lib/midi/melody";
import {
  clampTranspose,
  defaultTranspose,
  type Transpose,
} from "@/lib/midi/song";

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
  /** Semitones the song is moved by, so a part can sit where the hands are. */
  readonly transpose: Transpose;
  /** Strips the page back to the keys and the falling notes, for recording. */
  readonly focus: boolean;
  /** Seconds the playhead opens at, so a link can start partway through. */
  readonly start: number;
};

export const defaultStart = 0;

function isSpeed(value: number): value is Speed {
  return speeds.some((option) => option === value);
}

export function asSpeed(value: number): Speed {
  return isSpeed(value) ? value : defaultSpeed;
}

export type SongSettingKey =
  | "speed"
  | "tracks"
  | "simplified"
  | "melodyRate"
  | "transpose";

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
  if (searchParams.has("transpose")) {
    present.add("transpose");
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

function readStart(raw: string | null): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : defaultStart;
}

/** The origins whose MIDI files are allowed to reach the player, read from a
 * comma separated env list. The app's own origin (which serves the source
 * proxy) is added by the caller, so the default is everything through our own
 * server plus nothing external. */
export function parseTrustedOrigins(raw: string | undefined): string[] {
  const origins: string[] = [];
  for (const entry of (raw ?? "").split(",")) {
    const trimmed = entry.trim();
    if (trimmed === "") {
      continue;
    }
    // Normalise to a bare origin so a trailing slash or an explicit default
    // port in the env still matches what the URL parser produces.
    try {
      origins.push(new URL(trimmed).origin);
    } catch {
      // A host with no scheme has no origin of its own; assume https.
      try {
        origins.push(new URL(`https://${trimmed}`).origin);
      } catch {
        // not a usable origin, drop it
      }
    }
  }
  return origins;
}

/** A raw url is played only from an allowed origin, so a crafted link cannot
 * point the player at an arbitrary host. Our own upload scheme always passes. */
export function isPlayableUrl(
  url: string,
  allowed: readonly string[],
): boolean {
  if (/^local:[a-z0-9-]+$/.test(url)) {
    return true;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }
  return allowed.includes(parsed.origin);
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
  if (explicit || params.transpose !== defaultTranspose) {
    target.searchParams.set("transpose", String(params.transpose));
  }
  if (params.focus) {
    target.searchParams.set("focus", "1");
  }
  if (params.start > 0) {
    target.searchParams.set("start", String(params.start));
  }
  return target.toString();
}

const localBase = "http://player.local";

export function playerPath(mode: PlayerMode, params: PlayerParams): string {
  return buildPlayerUrl(localBase, mode, params).slice(localBase.length);
}

/** Returns null unless the url is our `local:` upload id or an http(s) file
 * from an allowed origin, which keeps a crafted link from pointing the player
 * at an arbitrary or `javascript:` target. */
export function parsePlayerParams(
  searchParams: URLSearchParams,
  allowedOrigins: readonly string[],
): PlayerParams | null {
  const url = searchParams.get("url");
  if (url === null || !isPlayableUrl(url, allowedOrigins)) {
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
  const transpose = Number(searchParams.get("transpose"));

  return {
    url,
    name: searchParams.get("name") ?? "",
    source: searchParams.get("source"),
    tracks,
    speed: isSpeed(speed) ? speed : defaultSpeed,
    simplified: searchParams.get("simple") === "1",
    melodyRate: readRate(searchParams.get("rate")),
    transpose: clampTranspose(transpose),
    focus: searchParams.get("focus") === "1",
    start: readStart(searchParams.get("start")),
  };
}
