import { type Hand, hands } from "@/lib/midi/hands";
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
import {
  clampNotationView,
  type NotationView,
  type SheetTheme,
} from "@/lib/sheet/types";
import {
  type BackgroundChoice,
  isAddedSkinId,
  readBackdrop,
  writeBackdrop,
} from "@/lib/skins/backdrop";
import { skinIds } from "@/lib/skins/types";
import { isDeviceLocal, isPlayableUrl } from "@/lib/trusted-url";

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
  /** Which hand of the chosen tracks to play. Null plays both. */
  readonly hand: Hand | null;
  /** Semitones the song is moved by, so a part can sit where the hands are. */
  readonly transpose: Transpose;
  /** Strips the page back to the keys and the falling notes, for recording. */
  readonly focus: boolean;
  /** The background drawn behind the roll. Carried in the link so a shared one
   * arrives looking the way it was sent, except for a picture kept on the
   * device that sent it, which loads nowhere else. */
  readonly skin: BackgroundChoice | null;
  /** Sends the notes out of the keys rather than onto them. A look rather than
   * a way to read ahead, so it rides in the link with the background. */
  readonly rise: boolean;
  /** How much of the view the notation takes. Null leaves whatever the device
   * remembers alone, so only a link that asks for a view imposes one. */
  readonly notation: NotationView | null;
  /** Which ground the notation is drawn on, on the same terms as the view. */
  readonly sheetTheme: SheetTheme | null;
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
  | "hand"
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
  if (searchParams.has("hand")) {
    present.add("hand");
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

function readHand(raw: string | null): Hand | null {
  return hands.find((hand) => hand === raw) ?? null;
}

function readStart(raw: string | null): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : defaultStart;
}

/** Null where the link says nothing, which is what leaves the reader's own
 * choice of view standing. */
function readNotation(raw: string | null): NotationView | null {
  return raw === null ? null : clampNotationView(raw);
}

function readSheetTheme(raw: string | null): SheetTheme | null {
  return raw === null ? null : raw === "1" ? "light" : "dark";
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
  if (explicit || params.hand !== null) {
    target.searchParams.set("hand", params.hand ?? "both");
  }
  if (explicit || params.transpose !== defaultTranspose) {
    target.searchParams.set("transpose", String(params.transpose));
  }
  if (
    params.skin !== null &&
    (params.skin.kind !== "image" || !isDeviceLocal(params.skin.image.source))
  ) {
    target.searchParams.set(
      "skin",
      params.skin.kind === "built-in" || params.skin.kind === "script"
        ? params.skin.id
        : writeBackdrop(params.skin.image),
    );
  }
  if (params.rise) {
    target.searchParams.set("rise", "1");
  }
  // Named only where the link means to impose one, the way a background is:
  // saying nothing leaves the reader reading the way they already were.
  if (params.notation !== null) {
    target.searchParams.set("notation", params.notation);
  }
  if (params.sheetTheme !== null) {
    target.searchParams.set("paper", params.sheetTheme === "light" ? "1" : "0");
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

/** A background this build ships, or a picture from a host the deployment
 * trusts. Anything else falls back to the plain roll rather than leaving a
 * blank layer. */
export function readSkinChoice(
  raw: string | null,
  allowedOrigins: readonly string[],
): BackgroundChoice | null {
  const built = skinIds.find((id) => id === raw);
  if (built !== undefined) {
    return { kind: "built-in", id: built };
  }
  if (raw !== null && isAddedSkinId(raw)) {
    return { kind: "script", id: raw };
  }
  const image = readBackdrop(raw, allowedOrigins);
  return image === null ? null : { kind: "image", image };
}

export function playerPath(mode: PlayerMode, params: PlayerParams): string {
  return buildPlayerUrl(localBase, mode, params).slice(localBase.length);
}

/** What to call a song whose link carries no name: the file the address points
 * at. Our own file endpoint keeps the path it is serving in `id`, so that is
 * read before the endpoint's own name, which is the same for every song. */
export function nameFromUrl(url: string): string {
  const parsed = readUrl(url);
  const path = parsed?.searchParams.get("id") ?? parsed?.pathname ?? url;
  const last = path.split("/").filter(Boolean).pop() ?? "";
  const name = decodeSegment(last).replace(/\.midi?$/i, "");
  // A directory address names no file, so the host stands in as the title.
  return name === "" ? (parsed?.hostname ?? "") : name;
}

/** A stray `%` is a segment that was never encoded, and this runs on the server
 * while a page is being built, where a throw is a 500 rather than a missing
 * song. */
function decodeSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    if (error instanceof URIError) {
      return value;
    }
    throw error;
  }
}

function readUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
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

  const named = searchParams.get("name")?.trim() ?? "";

  return {
    url,
    name: named === "" ? nameFromUrl(url) : named,
    source: searchParams.get("source"),
    tracks,
    speed: isSpeed(speed) ? speed : defaultSpeed,
    simplified: searchParams.get("simple") === "1",
    melodyRate: readRate(searchParams.get("rate")),
    hand: readHand(searchParams.get("hand")),
    transpose: clampTranspose(transpose),
    focus: searchParams.get("focus") === "1",
    rise: searchParams.get("rise") === "1",
    notation: readNotation(searchParams.get("notation")),
    sheetTheme: readSheetTheme(searchParams.get("paper")),
    skin: readSkinChoice(searchParams.get("skin"), allowedOrigins),
    start: readStart(searchParams.get("start")),
  };
}
