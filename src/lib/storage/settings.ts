import type { Transpose } from "@/lib/midi/song";
import { run, stores } from "@/lib/storage/idb";
import { entryKey } from "@/lib/storage/library";

/** Settings that belong to a song: the same tune keeps them across watch,
 * learn and multiplayer, and gets them back when it opens again. */
export type SongSettings = {
  readonly speed: number;
  readonly tracks: readonly number[];
  readonly simplified: boolean;
  readonly melodyRate: number;
  /** Absent on rows written before the song could be moved to another key. */
  readonly transpose?: Transpose;
};

/** Settings that belong to the hands and the screen, so they hold across
 * every song. */
export type GlobalSettings = {
  readonly keyWidth: number;
  readonly latencyOffset: number;
  /** Absent on rows written before the keys could be lettered. */
  readonly showKeyLabels?: boolean;
  /** Absent on rows written before the plain style existed. */
  readonly plainStyle?: boolean;
};

const globalKey = "global";

type Stored<T> = T & { readonly key: string };

export function songSettingsKey(source: string | null, url: string): string {
  return entryKey(source, url);
}

export async function loadSongSettings(
  key: string,
): Promise<SongSettings | null> {
  const row = await run<Stored<SongSettings> | undefined>(
    stores.settings,
    "readonly",
    (store) => store.get(key),
  );
  return row === undefined ? null : stripKey(row);
}

export async function saveSongSettings(
  key: string,
  settings: SongSettings,
): Promise<void> {
  await run(stores.settings, "readwrite", (store) =>
    store.put({ ...settings, key }),
  );
}

export async function loadGlobalSettings(): Promise<GlobalSettings | null> {
  const row = await run<Stored<GlobalSettings> | undefined>(
    stores.settings,
    "readonly",
    (store) => store.get(globalKey),
  );
  return row === undefined ? null : stripKey(row);
}

export async function saveGlobalSettings(
  settings: GlobalSettings,
): Promise<void> {
  await run(stores.settings, "readwrite", (store) =>
    store.put({ ...settings, key: globalKey }),
  );
}

function stripKey<T>(row: Stored<T>): T {
  const { key: _key, ...rest } = row;
  return rest as T;
}
