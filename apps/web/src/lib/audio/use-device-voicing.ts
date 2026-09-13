"use client";

import { useCallback, useEffect, useRef } from "react";
import type { StoredVoicing } from "@/lib/audio/voicing";
import { saveSongVoicing } from "@/lib/storage/settings";

/** Long enough that a hand still moving has not written yet, short enough that
 * a song left straight after an edit keeps it. */
const settleMs = 250;

export type DeviceVoicingWriter = {
  readonly write: (tracks: StoredVoicing) => void;
  /** Drops whatever is waiting, for a change that is not an edit of what is
   * already there. */
  readonly cancel: () => void;
};

/** Keeps every edit on this device, so a listener with no account keeps what
 * they made and a signed in one keeps it while it is still unsaved.
 *
 * The first is written at once, since picking an instrument and leaving is one
 * gesture. What follows within the window is held for the end of it: dragging
 * an envelope handle shapes the track on every pointer move, and each write is
 * a database transaction of its own. */
export function useDeviceVoicing(key: string): DeviceVoicingWriter {
  const pending = useRef<StoredVoicing | null>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = useCallback(() => {
    if (settle.current !== null) {
      clearTimeout(settle.current);
      settle.current = null;
    }
    pending.current = null;
  }, []);

  /** Under the key the edit was made on, since a song can be left before what
   * was shaped on it has settled. */
  const flush = useCallback(
    (target: string) => {
      const tracks = pending.current;
      cancel();
      if (tracks !== null) {
        void saveSongVoicing(target, tracks).catch(() => {});
      }
    },
    [cancel],
  );

  useEffect(() => () => flush(key), [flush, key]);

  const write = useCallback(
    (tracks: StoredVoicing) => {
      if (settle.current !== null) {
        pending.current = tracks;
        return;
      }
      void saveSongVoicing(key, tracks).catch(() => {});
      settle.current = setTimeout(() => flush(key), settleMs);
    },
    [flush, key],
  );

  return { write, cancel };
}
