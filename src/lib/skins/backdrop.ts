import { type SkinId, skinIds } from "@/lib/skins/types";
import { isDeviceLocal, isPlayableUrl } from "@/lib/trusted-url";

/** A picture behind the roll, and how it sits there. Written into the `skin`
 * parameter in the shape of a CSS background, so a link says what it does
 * without a table to look it up in:
 *
 *     url(https://host/a.jpg) scroll brightness(60%)
 *
 * A picture either sits still, covering the roll, or travels with the notes,
 * which means tiled: one copy travelling would run out. Held still and
 * untouched unless it says otherwise. */
export type Backdrop = {
  /** An https address on a trusted host, or `local:` for a picture kept on this
   * device, which only this device can resolve. */
  readonly source: string;
  /** Travels with the notes, tiled so it never runs out. Still and covering
   * the roll otherwise. */
  readonly scroll: boolean;
  /** Percent, where 100 leaves the picture as it is. */
  readonly brightness: number;
};

/** What the roll is asked to put behind itself: a background this build ships,
 * or a picture someone brought. */
export type BackgroundChoice =
  | { readonly kind: "built-in"; readonly id: SkinId }
  /** One somebody added, held by the id it was stored under. The script itself
   * is fetched when it is drawn, so a link stays short and a background can be
   * changed without every link to it going stale. */
  | { readonly kind: "script"; readonly id: string }
  | { readonly kind: "image"; readonly image: Backdrop };

/** The shape of an added background's id, which is the only thing a link may
 * name it by. Held to what we mint so a crafted one cannot reach elsewhere. */
export function isAddedSkinId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
    value,
  );
}

export const backdropBrightness = { min: 10, max: 200 } as const;
export const plainBrightness = 100;

/** A picture asked for nothing beyond itself. */
export const plainBackdrop = {
  scroll: false,
  brightness: plainBrightness,
} as const;

function clampBrightness(percent: number): number {
  if (!Number.isFinite(percent)) {
    return plainBrightness;
  }
  return Math.min(
    backdropBrightness.max,
    Math.max(backdropBrightness.min, Math.round(percent)),
  );
}

const imagePattern = /^url\((.+?)\)\s*(.*)$/s;
const brightnessPattern = /^brightness\((\d+)%?\)$/;

/** Null for anything that is not a picture this page may load: an unparseable
 * value, or a host the deployment does not trust, both of which fall back to
 * the plain roll rather than leaving a blank layer. */
export function readBackdrop(
  raw: string | null,
  allowedOrigins: readonly string[],
): Backdrop | null {
  if (raw === null) {
    return null;
  }
  const match = imagePattern.exec(raw.trim());
  if (match === null) {
    return null;
  }
  const source = (match[1] ?? "").trim();
  // A picture held on one device resolves on that one only, so a link naming
  // one leaves whoever opens it with their own background.
  if (isDeviceLocal(source) || !isPlayableUrl(source, allowedOrigins)) {
    return null;
  }
  let { scroll, brightness } = plainBackdrop as {
    scroll: boolean;
    brightness: number;
  };
  // Unknown words are passed over the way a browser passes over a property it
  // does not know, so a link written against a later build still shows a
  // picture rather than nothing.
  for (const word of (match[2] ?? "").split(/\s+/).filter(Boolean)) {
    if (word === "scroll") {
      scroll = true;
    } else if (word === "fixed") {
      scroll = false;
    } else {
      const percent = brightnessPattern.exec(word);
      if (percent !== null) {
        brightness = clampBrightness(Number(percent[1]));
      }
    }
  }
  return { source, scroll, brightness };
}

/** The shortest form that reads back the same, so a link carries only what was
 * actually chosen. */
export function writeBackdrop(backdrop: Backdrop): string {
  const words = [`url(${backdrop.source})`];
  if (backdrop.scroll) {
    words.push("scroll");
  }
  if (backdrop.brightness !== plainBrightness) {
    words.push(`brightness(${backdrop.brightness}%)`);
  }
  return words.join(" ");
}

/** What this device saved, which on a device that picked one before pictures
 * existed is a bare id. Read rather than trusted, so an old choice survives
 * the shape changing under it. */
export function readStoredChoice(value: unknown): BackgroundChoice | null {
  if (typeof value === "string") {
    const built = skinIds.find((id) => id === value);
    return built === undefined ? null : { kind: "built-in", id: built };
  }
  if (typeof value !== "object" || value === null || !("kind" in value)) {
    return null;
  }
  const held = value as { kind?: unknown; id?: unknown; image?: unknown };
  if (held.kind === "built-in") {
    const built = skinIds.find((id) => id === held.id);
    return built === undefined ? null : { kind: "built-in", id: built };
  }
  const image = held.image as Partial<Backdrop> | undefined;
  // Only a picture this device kept: a remote address saved by an older build
  // was never held to the allowlist, and this is not where that is checked.
  if (typeof image?.source !== "string" || !isDeviceLocal(image.source)) {
    return null;
  }
  return {
    kind: "image",
    image: {
      source: image.source,
      scroll: image.scroll === true,
      brightness: clampBrightness(Number(image.brightness)),
    },
  };
}
