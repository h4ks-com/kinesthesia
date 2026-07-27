"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  skins as everySkin,
  findSkin,
  skinsFor,
  suitsDirection,
} from "@/lib/skins/registry";
import type { NoteDirection, Skin, SkinId } from "@/lib/skins/types";
import { skinReads } from "@/lib/skins/types";
import {
  loadGlobalSettings,
  updateGlobalSettings,
} from "@/lib/storage/settings";
import { useReducedMotion } from "@/lib/use-reduced-motion";

export type Background = {
  /** What is picked, whether or not it can run here. The picker ticks this. */
  readonly chosen: SkinId | null;
  /** What the roll should actually draw, once plain style, reduced motion and
   * the direction have had their say. */
  readonly skin: Skin | null;
  readonly direction: NoteDirection;
  /** Which backgrounds are worth offering here. */
  readonly offered: readonly Skin[];
  /** True where the player may turn the notes around at all. */
  readonly canTurn: boolean;
  /** The background deciding the direction on its own, so the control can say
   * why it will not move. */
  readonly heldBy: Skin | null;
  choose: (next: SkinId | null) => void;
  turn: (rising: boolean) => void;
};

type Options = {
  /** The direction this mode is stuck with, or null where the player chooses.
   * Free roam always shoots notes out of the keys; a mode that is played needs
   * them approaching. */
  readonly fixed: NoteDirection | null;
  /** Plain style takes the background with it. */
  readonly plain: boolean;
  /** What the link asked for. It only decides anything for a player who has
   * never picked one: a background is this device's own setting, and someone
   * else's link does not get to replace it. A system asking for less movement
   * refuses a link's background outright. */
  readonly fromLink: { readonly skin: SkinId | null; readonly rise: boolean };
  /** Told whenever the choice changes, so the address bar can carry what is on
   * screen. Absent where there is no link to keep. */
  readonly onChange?: (next: { skin: SkinId | null; rise: boolean }) => void;
};

/** Where a background and which way the notes travel are decided and
 * remembered. Both are ordinary settings, saved with the rest, so every mode
 * treats them the same way and a link only overrides them for that visit. */
export function useBackground({
  fixed,
  plain,
  fromLink,
  onChange,
}: Options): Background {
  const [chosen, setChosen] = useState<SkinId | null>(fromLink.skin);
  const [rising, setRising] = useState(fromLink.rise);
  // A link is a stranger's decoration; anything else is this player's own.
  const [linked, setLinked] = useState(fromLink.skin !== null);
  const bootstrapped = useRef(false);
  const report = useRef(onChange);
  report.current = onChange;
  // Read when a choice is made, so a handler never has to wait for the render
  // that carries it.
  const chosenNow = useRef(chosen);
  chosenNow.current = chosen;
  const risingNow = useRef(rising);
  risingNow.current = rising;

  useEffect(() => {
    if (bootstrapped.current) {
      return;
    }
    bootstrapped.current = true;
    void loadGlobalSettings().then((stored) => {
      if (stored === null) {
        return;
      }
      // Anything this device has been asked outranks the link.
      if (stored.skin !== undefined) {
        setChosen(stored.skin);
        setLinked(false);
      }
      if (stored.rise !== undefined) {
        setRising(stored.rise);
      }
    });
  }, []);

  const still = useReducedMotion();
  const wanted = plain || (still && linked) ? null : findSkin(chosen);

  // A background that reads only one way decides the direction, so turning the
  // notes around can never make one vanish under the player.
  const heldBy =
    fixed === null &&
    wanted !== null &&
    !(skinReads(wanted.id, "up") && skinReads(wanted.id, "down"))
      ? wanted
      : null;
  const direction: NoteDirection =
    fixed ??
    (heldBy !== null
      ? skinReads(heldBy.id, "up")
        ? "up"
        : "down"
      : rising
        ? "up"
        : "down");

  const choose = useCallback((next: SkinId | null) => {
    setChosen(next);
    setLinked(false);
    // Picking a background that only reads one way is the whole of the choice
    // for anyone who does not want to make two.
    const turned =
      next !== null && !skinReads(next, "down")
        ? true
        : next !== null && !skinReads(next, "up")
          ? false
          : null;
    if (turned !== null) {
      setRising(turned);
      risingNow.current = turned;
    }
    chosenNow.current = next;
    void updateGlobalSettings(
      turned === null ? { skin: next } : { skin: next, rise: turned },
    );
    report.current?.({ skin: next, rise: turned ?? risingNow.current });
  }, []);

  const turn = useCallback((next: boolean) => {
    setRising(next);
    void updateGlobalSettings({ rise: next });
    report.current?.({ skin: chosenNow.current, rise: next });
  }, []);

  return {
    chosen,
    skin: wanted !== null && suitsDirection(wanted, direction) ? wanted : null,
    direction,
    offered: fixed === null ? everySkin : skinsFor(fixed),
    canTurn: fixed === null,
    heldBy,
    choose,
    turn,
  };
}
