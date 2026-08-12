const databaseName = "kinesthesia";
const databaseVersion = 5;

export const stores = {
  recent: "recent",
  favourite: "favourite",
  settings: "settings",
  uploads: "uploads",
  pictures: "pictures",
  /** Its own store because its key is a bare url, while a settings key carries
   * the provider a link named, and a link naming the provider `voicing` would
   * otherwise write one row over the other. */
  voicings: "voicings",
} as const;

export type StoreName = (typeof stores)[keyof typeof stores];

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);
    request.onupgradeneeded = () => {
      const database = request.result;
      for (const store of Object.values(stores)) {
        if (!database.objectStoreNames.contains(store)) {
          database.createObjectStore(store, { keyPath: "key" });
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function run<T>(
  store: StoreName,
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
