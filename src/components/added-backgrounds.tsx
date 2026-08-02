"use client";

import { useEffect, useRef, useState } from "react";
import { Choice, Preview } from "@/components/skin-picker";
import type { MidiShortcuts } from "@/lib/input/midi-shortcuts";
import type { BackgroundChoice } from "@/lib/skins/backdrop";
import { scriptBackdrop } from "@/lib/skins/runtime/host";
import type { BackdropSource } from "@/lib/skins/types";
import { useNearby } from "@/lib/use-nearby";

type Added = {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
};

/** One tile, which fetches and runs its script only once it is near enough to
 * be looked at. Every preview is a worker of its own, and there may be a great
 * many of these, so a picker that started all of them at once would take the tab
 * down before anybody chose one. */
function AddedTile({
  skin,
  chosen,
  onChoose,
  onClose,
  shortcuts,
}: {
  skin: Added;
  chosen: BackgroundChoice | null;
  onChoose: (next: BackgroundChoice) => void;
  onClose: () => void;
  shortcuts: MidiShortcuts | null;
}) {
  const holder = useRef<HTMLDivElement | null>(null);
  const [source, setSource] = useState<BackdropSource | null>(null);
  const [broke, setBroke] = useState(false);
  const near = useNearby(holder);

  useEffect(() => {
    if (!near) {
      return;
    }
    let wanted = true;
    fetch(`/api/skins/${skin.id}`)
      .then((answer) => (answer.ok ? answer.text() : null))
      .then((text) => {
        if (!wanted) {
          return;
        }
        if (text === null) {
          setBroke(true);
          return;
        }
        setSource(
          scriptBackdrop(text, {
            onBroke: () => setBroke(true),
            announce: false,
          }),
        );
      })
      .catch(() => {
        if (wanted) {
          setBroke(true);
        }
      });
    return () => {
      wanted = false;
    };
  }, [near, skin.id]);

  return (
    <Choice
      ref={holder}
      title={skin.name}
      blurb={broke ? "Does not run here." : skin.blurb}
      selected={chosen?.kind === "script" && chosen.id === skin.id}
      disabled={broke}
      onSelect={() => {
        onChoose({ kind: "script", id: skin.id });
        onClose();
      }}
      target={{ kind: "script", id: skin.id }}
      shortcuts={shortcuts}
    >
      {source === null || broke ? (
        <span className="block h-24 w-full rounded-lg bg-void" />
      ) : (
        <Preview source={source} onUnsupported={() => setBroke(true)} />
      )}
    </Choice>
  );
}

/** The backgrounds somebody added over the api, shown after the ones this build
 * ships. Absent entirely where there are none, since an empty heading says
 * nothing a reader wanted to know. */
export function AddedBackgrounds({
  chosen,
  onChoose,
  onClose,
  shortcuts,
}: {
  chosen: BackgroundChoice | null;
  onChoose: (next: BackgroundChoice) => void;
  onClose: () => void;
  shortcuts: MidiShortcuts | null;
}) {
  const [added, setAdded] = useState<readonly Added[]>([]);

  useEffect(() => {
    let wanted = true;
    fetch("/api/skins")
      .then((answer) => (answer.ok ? answer.json() : null))
      .then((listing: { custom?: readonly Added[] } | null) => {
        if (wanted) {
          setAdded(listing?.custom ?? []);
        }
      })
      // Silent: the ones this build ships are the important half of the picker,
      // and a store that cannot be reached should cost the reader nothing.
      .catch(() => {});
    return () => {
      wanted = false;
    };
  }, []);

  if (added.length === 0) {
    return null;
  }

  return (
    <>
      <h3 className="mt-4 mb-2.5 font-semibold text-sm text-text">Added</h3>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {added.map((skin) => (
          <AddedTile
            key={skin.id}
            skin={skin}
            chosen={chosen}
            onChoose={onChoose}
            onClose={onClose}
            shortcuts={shortcuts}
          />
        ))}
      </div>
    </>
  );
}
