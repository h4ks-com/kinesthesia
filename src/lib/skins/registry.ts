import { scriptBackdrop } from "@/lib/skins/runtime/host";
import { abyssScript } from "@/lib/skins/scripts/abyss";
import { auroraScript } from "@/lib/skins/scripts/aurora";
import { cruiseScript } from "@/lib/skins/scripts/cruise";
import { emberScript } from "@/lib/skins/scripts/ember";
import { flowerScript } from "@/lib/skins/scripts/flower";
import { horizonScript } from "@/lib/skins/scripts/horizon";
import { inkScript } from "@/lib/skins/scripts/ink";
import { rainfallScript } from "@/lib/skins/scripts/rainfall";
import { smokeScript } from "@/lib/skins/scripts/smoke";
import { starfieldScript } from "@/lib/skins/scripts/starfield";
import type { NoteDirection, Skin, SkinId } from "@/lib/skins/types";
import { skinDirections, skinIds, skinReads } from "@/lib/skins/types";

/** Every background is a script, the ones this build ships as much as the ones
 * somebody wrote, and they all run the same way in the same worker. What the
 * picker needs before a worker has started, and only that, is written here: a
 * name to list and a line to read. The script carries them too, for the case
 * where it is opened on its own. */
type Listing = {
  readonly name: string;
  readonly blurb: string;
  readonly source: string;
};

const catalogue: Record<SkinId, Listing> = {
  starfield: {
    name: "Deep space",
    blurb:
      "Drifting gas and stars. The notes you play break the asteroids they reach.",
    source: starfieldScript,
  },
  cruise: {
    name: "Cruising",
    blurb:
      "The keys fly through space. Stars streak past, a world drifts by now and then, and the rocks your notes reach break apart.",
    source: cruiseScript,
  },
  aurora: {
    name: "Aurora",
    blurb:
      "Curtains of light over a black sky. They lift as you play, and the colour follows the register: blue at the bass end, magenta at the top.",
    source: auroraScript,
  },
  rainfall: {
    name: "Rainfall",
    blurb:
      "A storm behind glass. The rain falls the way the notes do, every key struck sets a ring spreading across the pane, and a full chord throws lightning.",
    source: rainfallScript,
  },
  abyss: {
    name: "Abyss",
    blurb:
      "Deep water with almost no light left in it. Schools of fish cross the shafts, a submarine passes now and then, and every note leaving the keys drags a column of bubbles up behind it.",
    source: abyssScript,
  },
  horizon: {
    name: "Horizon",
    blurb:
      "A neon grid running out to a sliced sun over a dark skyline. Each key struck fires a beam up off the floor on that key's line, so the distance reads as a second keyboard.",
    source: horizonScript,
  },
  ember: {
    name: "Ember",
    blurb:
      "Black rock with the heat still in it. Sparks lift off the keys as you play and cool on the way up, and a loud passage brings the glow along the keybed with it.",
    source: emberScript,
  },
  ink: {
    name: "Ink",
    blurb:
      "Near-black paper. A key struck blooms a cloud of ink that spreads, thins and is gone. The quietest of them, and the only one that never moves on its own.",
    source: inkScript,
  },
  flower: {
    name: "Flower",
    blurb:
      "A grey meadow that colours as the music turns major and fades back when it turns minor. Struck keys open flowers; the wind carries their petals off.",
    source: flowerScript,
  },
  smoke: {
    name: "Smoke",
    blurb:
      "Total darkness, and coloured smoke off every key struck. It gathers and drifts as you play, and notes climbing away from the keys push it aside.",
    source: smokeScript,
  },
};

/** A listing as the roll can mount it. One runner per background rather than
 * per mount, so switching away and back does not pay for the worker twice. */
function asSkin(id: SkinId, listing: Listing): Skin {
  const runner = scriptBackdrop(listing.source);
  return {
    id,
    name: listing.name,
    blurb: listing.blurb,
    directions: skinDirections[id],
    create: (surface, onBroke) => runner.create(surface, onBroke),
  };
}

const byId: Record<SkinId, Skin> = Object.fromEntries(
  skinIds.map((id) => [id, asSkin(id, catalogue[id])]),
) as Record<SkinId, Skin>;

export const skins: readonly Skin[] = skinIds.map((id) => byId[id]);

/** The source a background is written in, for anything that wants to read one
 * rather than run it. */
export function skinSource(id: SkinId): string {
  return catalogue[id].source;
}

export function findSkin(id: string | null): Skin | null {
  return skins.find((skin) => skin.id === id) ?? null;
}

/** Whether a skin is worth offering for how notes are travelling. A scene flown
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
