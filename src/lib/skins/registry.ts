import { starfield } from "@/lib/skins/starfield";
import type { NoteDirection, Skin, SkinId } from "@/lib/skins/types";

/** The plain roll. Not a skin with an empty draw: choosing it means no second
 * canvas is mounted at all, so nothing is paid for the default. */
export const noSkin: SkinId = "none";

export const skins: readonly Skin[] = [starfield];

export function findSkin(id: SkinId): Skin | null {
  return skins.find((skin) => skin.id === id) ?? null;
}

/** Whether a skin is worth offering for how notes are travelling. A skin flown
 * through only reads when the notes are heading away from the keys. */
export function suitsDirection(skin: Skin, direction: NoteDirection): boolean {
  return skin.directions.includes(direction);
}

export function skinsFor(direction: NoteDirection): readonly Skin[] {
  return skins.filter((skin) => suitsDirection(skin, direction));
}
