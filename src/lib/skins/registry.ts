import { abyss } from "@/lib/skins/abyss";
import { aurora } from "@/lib/skins/aurora";
import { cruise } from "@/lib/skins/cruise";
import { ember } from "@/lib/skins/ember";
import { horizon } from "@/lib/skins/horizon";
import { ink } from "@/lib/skins/ink";
import { rainfall } from "@/lib/skins/rainfall";
import { starfield } from "@/lib/skins/starfield";
import type { NoteDirection, Skin, SkinId } from "@/lib/skins/types";
import { skinIds, skinReads } from "@/lib/skins/types";

/** Keyed so a new id cannot be declared without a skin to go with it. Null is
 * the plain roll: not a skin with an empty draw, but no second canvas at all,
 * so nothing is paid for the default. */
const byId: Record<SkinId, Skin> = {
  starfield,
  cruise,
  aurora,
  rainfall,
  abyss,
  horizon,
  ember,
  ink,
};

export const skins: readonly Skin[] = skinIds.map((id) => byId[id]);

export function findSkin(id: string | null): Skin | null {
  return skins.find((skin) => skin.id === id) ?? null;
}

/** Whether a skin is worth offering for how notes are travelling. A skin flown
 * through only reads when the notes are heading away from the keys. */
export function suitsDirection(skin: Skin, direction: NoteDirection): boolean {
  return skinReads(skin.id, direction);
}

export function skinsFor(direction: NoteDirection): readonly Skin[] {
  return skins.filter((skin) => suitsDirection(skin, direction));
}

/** What may be offered where. Watch takes any background, since the notes
 * follow whichever one is picked; a mode that is played can only take one that
 * reads with the notes coming down, because the approach is how you know what
 * to play. */
export function offeredSkins(mayRise: boolean): readonly Skin[] {
  return mayRise ? skins : skinsFor("down");
}

/** The one rule for which way notes travel: a song falls onto the keys unless a
 * background the player chose is built to be flown out of. Held here so the
 * roll, the video export and the link validator cannot drift apart. */
export function directionFor(
  skin: Skin | null,
  mayRise: boolean,
): NoteDirection {
  return mayRise && skin !== null && suitsDirection(skin, "up") ? "up" : "down";
}
