"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clampLatency } from "@/lib/audio/latency";
import type { Hand } from "@/lib/midi/hands";
import { clampMelodyRate, type MelodyRate } from "@/lib/midi/melody";
import {
  clampTranspose,
  defaultTranspose,
  type Transpose,
} from "@/lib/midi/song";
import {
  asSpeed,
  buildPlayerUrl,
  explicitSongSettings,
  type PlayerMode,
  type PlayerParams,
  type Speed,
} from "@/lib/player-url";
import { clampKeyWidth, defaultKeyWidth } from "@/lib/render/keyboard";
import {
  clampNotationView,
  clampSheetTheme,
  type NotationView,
  type SheetTheme,
} from "@/lib/sheet/types";
import type { BackgroundChoice } from "@/lib/skins/backdrop";
import {
  type GlobalSettings,
  loadGlobalSettings,
  loadSongSettings,
  saveSongSettings,
  songSettingsKey,
  updateGlobalSettings,
} from "@/lib/storage/settings";

const settleMs = 250;

type SongSettingsValue = {
  tracks: readonly number[];
  speed: Speed;
  simplified: boolean;
  melodyRate: MelodyRate;
  hand: Hand | null;
  transpose: Transpose;
};
type UrlChange = Partial<SongSettingsValue>;

/** How the notation is being read, which the link carries so a shared address
 * opens on the same page the sender was looking at. */
type Reading = {
  notation: NotationView;
  sheetTheme: SheetTheme;
};

type Options = {
  mode: PlayerMode;
  params: PlayerParams;
  locked: boolean;
  /** Read at write time, since focus changes reach the URL in the same tick
   * they are made, before the render that carries them. */
  getFocus: () => boolean;
  /** The background and direction on screen now, for the same reason: they are
   * settings of this device, and the link carries them so copying it hands
   * over the view rather than the song alone. */
  getView: () => { skin: BackgroundChoice | null; rise: boolean };
};

export type PlayerSettings = {
  playerTracks: ReadonlySet<number>;
  speed: Speed;
  latencyOffset: number;
  keyWidth: number;
  showKeyLabels: boolean;
  showNoteNames: boolean;
  plainStyle: boolean;
  hasKeyboard: boolean;
  simplified: boolean;
  melodyRate: MelodyRate;
  hand: Hand | null;
  transpose: Transpose;
  notationView: NotationView;
  sheetTheme: SheetTheme;
  /** True once the remembered settings have been read, so a default is only
   * claimed against what this device already knows. */
  hydrated: boolean;
  claimTrack: (index: number) => void;
  updateUrl: (next: UrlChange) => void;
  changeKeyWidth: (next: number) => void;
  changeLatency: (next: number) => void;
  changeKeyLabels: (next: boolean) => void;
  changeNoteNames: (next: boolean) => void;
  changePlainStyle: (next: boolean) => void;
  changeSimplified: (next: boolean) => void;
  changeMelodyRate: (next: number) => void;
  changeHand: (next: Hand | null) => void;
  changeTranspose: (next: Transpose) => void;
  changeSpeed: (next: Speed) => void;
  changeNotationView: (next: NotationView) => void;
  changeSheetTheme: (next: SheetTheme) => void;
  togglePlayerTrack: (index: number) => void;
};

/** The settings a song is played with, restored from what this device
 * remembers and written back to the URL as they change. A setting the link
 * states outright wins over the remembered one. */
export function usePlayerSettings({
  mode,
  params,
  locked,
  getFocus,
  getView,
}: Options): PlayerSettings {
  const [playerTracks, setPlayerTracks] = useState<ReadonlySet<number>>(
    new Set(params.tracks ?? []),
  );
  const [speed, setSpeed] = useState(params.speed);
  const [latencyOffset, setLatencyOffset] = useState(0);
  const [keyWidth, setKeyWidth] = useState(defaultKeyWidth);
  const [showKeyLabels, setShowKeyLabels] = useState(true);
  const [showNoteNames, setShowNoteNames] = useState(true);
  const [plainStyle, setPlainStyle] = useState(false);
  const [notationView, setNotationView] = useState<NotationView>(
    params.notation ?? "off",
  );
  const [sheetTheme, setSheetTheme] = useState<SheetTheme>(
    params.sheetTheme ?? "dark",
  );
  // A device with no fine pointer has no keyboard to letter the keys for.
  const [hasKeyboard, setHasKeyboard] = useState(false);
  const [simplified, setSimplified] = useState(params.simplified);
  const [melodyRate, setMelodyRate] = useState(params.melodyRate);
  const [hand, setHand] = useState(params.hand);
  const [transpose, setTranspose] = useState(params.transpose);

  // Read at write time, like focus and the background: a view change reaches
  // the URL in the same tick it is made, before the render that carries it.
  const readingRef = useRef<Reading>({
    notation: params.notation ?? "off",
    sheetTheme: params.sheetTheme ?? "dark",
  });

  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const globalTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingGlobal = useRef<Partial<GlobalSettings>>({});
  useEffect(
    () => () => {
      if (settleTimer.current !== null) {
        clearTimeout(settleTimer.current);
      }
      if (globalTimer.current !== null) {
        clearTimeout(globalTimer.current);
      }
    },
    [],
  );

  // Read at write time, so a deferred write never clobbers a change made after
  // it was scheduled.
  const settingsRef = useRef<SongSettingsValue>({
    tracks: [...playerTracks],
    speed,
    simplified,
    melodyRate,
    hand,
    transpose,
  });
  settingsRef.current = {
    tracks: [...playerTracks],
    speed,
    simplified,
    melodyRate,
    hand,
    transpose,
  };

  const merge = useCallback((next: UrlChange): SongSettingsValue => {
    const current = settingsRef.current;
    return {
      tracks: next.tracks ?? current.tracks,
      speed: next.speed ?? current.speed,
      simplified: next.simplified ?? current.simplified,
      melodyRate: next.melodyRate ?? current.melodyRate,
      hand: next.hand === undefined ? current.hand : next.hand,
      transpose: next.transpose ?? current.transpose,
    };
  }, []);

  const updateUrl = useCallback(
    (next: UrlChange) => {
      window.history.replaceState(
        null,
        "",
        buildPlayerUrl(
          window.location.origin,
          mode,
          {
            ...params,
            focus: getFocus(),
            ...getView(),
            ...readingRef.current,
            ...merge(next),
          },
          { explicit: true },
        ),
      );
    },
    [params, mode, merge, getFocus, getView],
  );

  // A locked match plays the agreed part, so it leaves what this device
  // remembers for the song untouched.
  const commit = useCallback(
    (next: UrlChange) => {
      updateUrl(next);
      if (!locked) {
        void saveSongSettings(
          songSettingsKey(params.source, params.url),
          merge(next),
        );
      }
    },
    [params, locked, updateUrl, merge],
  );

  const bootstrapped = useRef(false);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (bootstrapped.current) {
      return;
    }
    bootstrapped.current = true;
    const explicit = explicitSongSettings(
      new URLSearchParams(window.location.search),
    );
    setHasKeyboard(window.matchMedia("(any-pointer: fine)").matches);
    void loadGlobalSettings().then((stored) => {
      if (stored !== null) {
        setKeyWidth(clampKeyWidth(stored.keyWidth));
        setLatencyOffset(clampLatency(stored.latencyOffset));
        setShowKeyLabels(stored.showKeyLabels ?? true);
        setShowNoteNames(stored.showNoteNames ?? true);
        setPlainStyle(stored.plainStyle ?? false);
        // A link that asks to be read a particular way is asking on purpose,
        // so it stands over what this device remembers, and leaves the stored
        // choice where it is for the next link that asks for nothing.
        if (params.notation === null) {
          setNotationView(clampNotationView(stored.notationView));
        }
        if (params.sheetTheme === null) {
          setSheetTheme(clampSheetTheme(stored.sheetTheme));
        }
      }
    });
    if (locked) {
      setHydrated(true);
      return;
    }
    void loadSongSettings(songSettingsKey(params.source, params.url))
      .then((stored) => {
        if (stored === null) {
          return;
        }
        const next = {
          speed: explicit.has("speed") ? params.speed : asSpeed(stored.speed),
          simplified: explicit.has("simplified")
            ? params.simplified
            : stored.simplified,
          melodyRate: explicit.has("melodyRate")
            ? params.melodyRate
            : clampMelodyRate(stored.melodyRate),
          hand: explicit.has("hand") ? params.hand : (stored.hand ?? null),
          transpose: explicit.has("transpose")
            ? params.transpose
            : clampTranspose(stored.transpose ?? defaultTranspose),
          tracks: explicit.has("tracks") ? null : stored.tracks,
        };
        setSpeed(next.speed);
        setSimplified(next.simplified);
        setMelodyRate(next.melodyRate);
        setHand(next.hand);
        setTranspose(next.transpose);
        if (next.tracks !== null) {
          setPlayerTracks(new Set(next.tracks));
        }
        updateUrl({
          speed: next.speed,
          simplified: next.simplified,
          melodyRate: next.melodyRate,
          hand: next.hand,
          transpose: next.transpose,
          ...(next.tracks !== null && { tracks: next.tracks }),
        });
      })
      .finally(() => setHydrated(true));
  }, [params, locked, updateUrl]);

  // Publishing the default claim lets a multiplayer invite record the part the
  // host is actually about to play.
  const claimTrack = useCallback(
    (index: number) => {
      setPlayerTracks(new Set([index]));
      commit({ tracks: [index] });
    },
    [commit],
  );

  // A write per slider step trips Safari's replaceState limit, so the write
  // settles a moment after the last change while state tracks it live.
  function settleCommit(next: UrlChange) {
    if (settleTimer.current !== null) {
      clearTimeout(settleTimer.current);
    }
    settleTimer.current = setTimeout(() => commit(next), 250);
  }

  // Gathers the changes made inside one settle and writes only the fields this
  // view owns, so a setting another view changed meanwhile survives.
  function settleGlobal(patch: Partial<GlobalSettings>) {
    pendingGlobal.current = { ...pendingGlobal.current, ...patch };
    if (globalTimer.current !== null) {
      clearTimeout(globalTimer.current);
    }
    globalTimer.current = setTimeout(() => {
      const next = pendingGlobal.current;
      pendingGlobal.current = {};
      void updateGlobalSettings(next);
    }, settleMs);
  }

  function changeKeyWidth(next: number) {
    const width = clampKeyWidth(next);
    setKeyWidth(width);
    settleGlobal({ keyWidth: width });
  }

  function changeLatency(next: number) {
    const offset = clampLatency(next);
    setLatencyOffset(offset);
    settleGlobal({ latencyOffset: offset });
  }

  function changeKeyLabels(next: boolean) {
    setShowKeyLabels(next);
    settleGlobal({ showKeyLabels: next });
  }

  function changeNoteNames(next: boolean) {
    setShowNoteNames(next);
    settleGlobal({ showNoteNames: next });
  }

  function changePlainStyle(next: boolean) {
    setPlainStyle(next);
    settleGlobal({ plainStyle: next });
  }

  function changeNotationView(next: NotationView) {
    setNotationView(next);
    readingRef.current = { ...readingRef.current, notation: next };
    settleGlobal({ notationView: next });
    updateUrl({});
  }

  function changeSheetTheme(next: SheetTheme) {
    setSheetTheme(next);
    readingRef.current = { ...readingRef.current, sheetTheme: next };
    settleGlobal({ sheetTheme: next });
    updateUrl({});
  }

  function changeSimplified(next: boolean) {
    setSimplified(next);
    commit({ simplified: next });
  }

  function changeMelodyRate(next: number) {
    const rate = clampMelodyRate(next);
    setMelodyRate(rate);
    settleCommit({ melodyRate: rate });
  }

  function changeHand(next: Hand | null) {
    setHand(next);
    commit({ hand: next });
  }

  function changeTranspose(next: Transpose) {
    setTranspose(next);
    settleCommit({ transpose: next });
  }

  function changeSpeed(next: Speed) {
    setSpeed(next);
    settleCommit({ speed: next });
  }

  function togglePlayerTrack(index: number) {
    setPlayerTracks((current) => {
      const next = new Set(current);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      commit({ tracks: [...next].sort((left, right) => left - right) });
      return next;
    });
  }

  return {
    playerTracks,
    speed,
    latencyOffset,
    keyWidth,
    showKeyLabels,
    showNoteNames,
    plainStyle,
    hasKeyboard,
    simplified,
    melodyRate,
    hand,
    transpose,
    notationView,
    sheetTheme,
    hydrated,
    claimTrack,
    updateUrl,
    changeKeyWidth,
    changeLatency,
    changeKeyLabels,
    changeNoteNames,
    changePlainStyle,
    changeSimplified,
    changeMelodyRate,
    changeHand,
    changeTranspose,
    changeSpeed,
    changeNotationView,
    changeSheetTheme,
    togglePlayerTrack,
  };
}
