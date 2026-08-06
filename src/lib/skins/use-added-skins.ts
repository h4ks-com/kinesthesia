"use client";

import { useEffect, useState } from "react";

export type AddedSkin = {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
};

/** Asked for once a tab: the roll wants it on every visit and the picker wants
 * it again on every open, and only something outside the app can change it. */
let listing: Promise<readonly AddedSkin[]> | null = null;

function fetchListing(): Promise<readonly AddedSkin[]> {
  listing ??= fetch("/api/skins")
    .then((answer) => (answer.ok ? answer.json() : null))
    .then(
      (held: { custom?: readonly AddedSkin[] } | null) => held?.custom ?? [],
    )
    // Silent, and not kept, so a store that was unreachable once is asked
    // again. The ones this build ships are the half that matters.
    .catch(() => {
      listing = null;
      return [];
    });
  return listing;
}

/** The backgrounds somebody added over the api. Read from the listing rather
 * than remembered, so one taken away stops being offered. */
export function useAddedSkins(): readonly AddedSkin[] {
  const [added, setAdded] = useState<readonly AddedSkin[]>([]);

  useEffect(() => {
    let wanted = true;
    void fetchListing().then((held) => {
      if (wanted) {
        setAdded(held);
      }
    });
    return () => {
      wanted = false;
    };
  }, []);

  return added;
}
