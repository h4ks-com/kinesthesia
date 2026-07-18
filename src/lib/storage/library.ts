export type LibraryEntry = {
  readonly key: string;
  readonly url: string;
  readonly name: string;
  readonly source: string | null;
  readonly playedAt: number;
};

const databaseName = "kinesthesia";
const databaseVersion = 1;
const recentStore = "recent";
const favouriteStore = "favourite";
const recentLimit = 40;

export function entryKey(source: string | null, url: string): string {
  return `${source ?? "unknown"}:${url}`;
}

/** Every word has to appear somewhere in the name, so "queen rhap" finds
 * "Queen - Bohemian Rhapsody" without needing the words in order. */
export function matchesLibrary(entry: LibraryEntry, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return true;
  }
  const haystack = `${entry.name} ${entry.source ?? ""}`.toLowerCase();
  return words.every((word) => haystack.includes(word));
}

export function filterLibrary(
  entries: readonly LibraryEntry[],
  query: string,
): LibraryEntry[] {
  return entries.filter((entry) => matchesLibrary(entry, query));
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);
    request.onupgradeneeded = () => {
      const database = request.result;
      for (const store of [recentStore, favouriteStore]) {
        if (!database.objectStoreNames.contains(store)) {
          database.createObjectStore(store, { keyPath: "key" });
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function run<T>(
  store: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (database) =>
      new Promise<T>((resolve, reject) => {
        const transaction = database.transaction(store, mode);
        const request = action(transaction.objectStore(store));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => database.close();
      }),
  );
}

function byNewest(entries: LibraryEntry[]): LibraryEntry[] {
  return entries.sort((left, right) => right.playedAt - left.playedAt);
}

export async function recordPlay(
  entry: Omit<LibraryEntry, "key" | "playedAt">,
): Promise<void> {
  const full: LibraryEntry = {
    ...entry,
    key: entryKey(entry.source, entry.url),
    playedAt: Date.now(),
  };
  await run(recentStore, "readwrite", (store) => store.put(full));
  const all = byNewest(
    await run<LibraryEntry[]>(recentStore, "readonly", (store) =>
      store.getAll(),
    ),
  );
  for (const stale of all.slice(recentLimit)) {
    await run(recentStore, "readwrite", (store) => store.delete(stale.key));
  }
}

export async function listRecent(): Promise<LibraryEntry[]> {
  const all = await run<LibraryEntry[]>(recentStore, "readonly", (store) =>
    store.getAll(),
  );
  return byNewest(all).slice(0, recentLimit);
}

export async function listFavourites(): Promise<LibraryEntry[]> {
  return byNewest(
    await run<LibraryEntry[]>(favouriteStore, "readonly", (store) =>
      store.getAll(),
    ),
  );
}

export async function toggleFavourite(
  entry: Omit<LibraryEntry, "key" | "playedAt">,
): Promise<boolean> {
  const key = entryKey(entry.source, entry.url);
  const existing = await run<LibraryEntry | undefined>(
    favouriteStore,
    "readonly",
    (store) => store.get(key),
  );
  if (existing !== undefined) {
    await run(favouriteStore, "readwrite", (store) => store.delete(key));
    return false;
  }
  await run(favouriteStore, "readwrite", (store) =>
    store.put({ ...entry, key, playedAt: Date.now() }),
  );
  return true;
}
