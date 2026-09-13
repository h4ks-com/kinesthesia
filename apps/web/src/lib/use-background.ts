"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type BackgroundChoice, readStoredChoice } from "@/lib/skins/backdrop";
import { pictureBackdrop } from "@/lib/skins/picture";
import {
  skins as everySkin,
  findSkin,
  skinsFor,
  suitsDirection,
} from "@/lib/skins/registry";
import { scriptBackdrop } from "@/lib/skins/runtime/host";
import type { BackdropSource, NoteDirection, Skin } from "@/lib/skins/types";
import { skinReads } from "@/lib/skins/types";
import { useAddedSkins } from "@/lib/skins/use-added-skins";
import { pictureHref } from "@/lib/storage/pictures";
import {
  loadGlobalSettings,
  updateGlobalSettings,
} from "@/lib/storage/settings";
import { isDeviceLocal } from "@/lib/trusted-url";

export type Background = {
  /** What is picked, whether or not it can run here. The picker ticks this. */
  readonly chosen: BackgroundChoice | null;
  /** What the roll should actually draw, once plain style, reduced motion and
   * the direction have had their say. */
  readonly skin: Skin | null;
  /** What the roll mounts behind itself, whichever kind was picked. Null for
   * the plain roll, and while a picture kept on this device is still being
   * read out of storage. */
  readonly source: BackdropSource | null;
  /** What to call it, for the control that names the current background. */
  readonly name: string;
  readonly direction: NoteDirection;
  /** Which backgrounds are worth offering here. */
  readonly offered: readonly Skin[];
  /** Everything a controller can step through: what this build ships, then
   * what has been added, then plain so a full throw clears the roll. Built
   * from the live listing, so one taken away leaves the cycle by itself. */
  readonly cycle: readonly (BackgroundChoice | null)[];
  /** True where the player may turn the notes around at all. */
  readonly canTurn: boolean;
  /** The background deciding the direction on its own, so the control can say
   * why it will not move. */
  readonly heldBy: Skin | null;
  choose: (next: BackgroundChoice | null) => void;
  turn: (rising: boolean) => void;
};

type Options = {
  /** The direction this mode is stuck with, or null where the player chooses.
   * Free roam always shoots notes out of the keys; a mode that is played needs
   * them approaching. */
  readonly fixed: NoteDirection | null;
  /** Plain style takes the background with it. */
  readonly plain: boolean;
  /** What the link asked for. A link naming a background is showing something
   * on purpose, so it wins over what this device remembers for the visit. */
  readonly fromLink: {
    readonly skin: BackgroundChoice | null;
    readonly rise: boolean;
  };
  /** Told whenever the choice changes, so the address bar can carry what is on
   * screen. Absent where there is no link to keep. */
  readonly onChange?: (next: {
    skin: BackgroundChoice | null;
    rise: boolean;
  }) => void;
};

/** How long after the last change a choice is written down. Long enough that
 * dragging a slider is one write rather than forty. */
const keepAfterMs = 250;

/** Where a background and which way the notes travel are decided and
 * remembered. Both are ordinary settings, saved with the rest, so every mode
 * treats them the same way and a link only overrides them for that visit. */
export function useBackground({
  fixed,
  plain,
  fromLink,
  onChange,
}: Options): Background {
  const [chosen, setChosen] = useState<BackgroundChoice | null>(fromLink.skin);
  const [rising, setRising] = useState(fromLink.rise);
  const addedSkins = useAddedSkins();
  /** What the address named when the page opened, which is the only moment it
   * can. */
  const linkAsked = useRef({
    skin: fromLink.skin !== null,
    rise: fromLink.rise,
  });
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
      // A link naming a background is showing something on purpose, so it is
      // what this visit gets. Only where the link says nothing does what this
      // device remembers decide.
      if (stored.skin !== undefined && !linkAsked.current.skin) {
        setChosen(readStoredChoice(stored.skin));
      }
      // The link carries this only when it wants the notes turned around.
      if (stored.rise !== undefined && !linkAsked.current.rise) {
        setRising(stored.rise);
      }
    });
  }, []);

  // A picture kept on this device has to be read out of storage before it can
  // be drawn, and the address it becomes is ours to let go of.
  const [href, setHref] = useState<string | null>(null);
  const [lost, setLost] = useState<string | null>(null);
  const wanted =
    plain || chosen?.kind !== "built-in" ? null : findSkin(chosen.id);
  const image = plain || chosen?.kind !== "image" ? null : chosen.image;

  /** One somebody added. Its script is fetched rather than bundled, so it is
   * held here until it arrives and the roll stays plain in the meantime. */
  const added = plain || chosen?.kind !== "script" ? null : chosen.id;
  const [addedSource, setAddedSource] = useState<{
    readonly id: string;
    readonly source: string;
  } | null>(null);
  /** Says so rather than falling quietly back to the plain roll, the way a
   * picture that has gone does. */
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    if (added === null) {
      setAddedSource(null);
      return;
    }
    let live = true;
    setMissing(false);
    void fetch(`/api/skins/${added}`)
      .then(async (answer) => (answer.ok ? await answer.text() : null))
      .then((source) => {
        if (!live) {
          return;
        }
        if (source === null) {
          // Dropped for this visit only. The store answers the same way for a
          // background that was taken away and for one it cannot reach just
          // now, so what is written down has to survive a bad moment.
          setMissing(true);
          setChosen(null);
        } else {
          setAddedSource({ id: added, source });
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [added]);

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

  const source = image?.source ?? null;
  useEffect(() => {
    if (source === null) {
      setHref(null);
      return;
    }
    let live = true;
    let made: string | null = null;
    void pictureHref(source).then((resolved) => {
      if (!live) {
        if (resolved !== null && isDeviceLocal(source)) {
          URL.revokeObjectURL(resolved);
        }
        return;
      }
      made = isDeviceLocal(source) ? resolved : null;
      setLost(null);
      setHref(resolved);
    });
    return () => {
      live = false;
      if (made !== null) {
        URL.revokeObjectURL(made);
      }
    };
  }, [source]);

  // One instance per picture, since the roll rebuilds its layer whenever this
  // changes and a picture rebuilt every render never finishes loading.
  const source_ = useMemo(
    () =>
      image === null || href === null
        ? null
        : pictureBackdrop(image, href, direction, () => setLost(href)),
    [image, href, direction],
  );

  /** An added background, once its script is here and is the one asked for. A
   * broken one drops the roll back to plain rather than leaving a dead layer. */
  const addedSource_ = useMemo(
    () =>
      addedSource === null || addedSource.id !== added
        ? null
        : scriptBackdrop(addedSource.source, {
            onBroke: () => setChosen(null),
          }),
    [addedSource, added],
  );

  // A slider shaping a picture calls this on every step, and a write each time
  // both floods the settings store and trips Safari's replaceState limit. The
  // choice shows at once; keeping it settles a moment after the last change.
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (settle.current !== null) {
        clearTimeout(settle.current);
      }
    },
    [],
  );

  const choose = useCallback((next: BackgroundChoice | null) => {
    const held = chosenNow.current;
    const shaping =
      next?.kind === "image" &&
      held?.kind === "image" &&
      next.image.source === held.image.source;
    setChosen(next);
    // Picking a background that only reads one way is the whole of the choice
    // for anyone who does not want to make two.
    // A picture reads either way, so only a background this build ships can
    // decide the direction on the player's behalf.
    const built = next?.kind === "built-in" ? next.id : null;
    const turned =
      built !== null && !skinReads(built, "down")
        ? true
        : built !== null && !skinReads(built, "up")
          ? false
          : null;
    if (turned !== null) {
      setRising(turned);
      risingNow.current = turned;
    }
    chosenNow.current = next;
    const rise = turned ?? risingNow.current;
    const keep = (): void => {
      void updateGlobalSettings(
        turned === null ? { skin: next } : { skin: next, rise: turned },
      );
      report.current?.({ skin: next, rise });
    };
    if (settle.current !== null) {
      clearTimeout(settle.current);
    }
    // Picking one is a single act and is written at once. Shaping the picture
    // already picked runs off a slider, so it settles instead.
    if (shaping) {
      settle.current = setTimeout(keep, keepAfterMs);
    } else {
      keep();
    }
  }, []);

  const turn = useCallback((next: boolean) => {
    setRising(next);
    void updateGlobalSettings({ rise: next });
    report.current?.({ skin: chosenNow.current, rise: next });
  }, []);

  const offered = fixed === null ? everySkin : skinsFor(fixed);
  const cycle: readonly (BackgroundChoice | null)[] = [
    ...offered.map((skin) => ({ kind: "built-in" as const, id: skin.id })),
    ...addedSkins.map((skin) => ({ kind: "script" as const, id: skin.id })),
    null,
  ];

  return {
    chosen,
    skin: wanted !== null && suitsDirection(wanted, direction) ? wanted : null,
    direction,
    offered,
    cycle,
    canTurn: fixed === null,
    heldBy,
    source: source_ ?? addedSource_ ?? wanted,
    name:
      source_ !== null && lost !== href
        ? "your picture"
        : source_ !== null
          ? "picture missing"
          : missing
            ? "background missing"
            : addedSource_ !== null
              ? (addedSkins
                  .find((skin) => skin.id === added)
                  ?.name.toLowerCase() ?? "an added background")
              : (wanted?.name.toLowerCase() ?? "plain"),
    choose,
    turn,
  };
}
