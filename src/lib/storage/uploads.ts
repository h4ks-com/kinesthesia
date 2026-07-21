import { run, stores } from "@/lib/storage/idb";
import { entryKey, type LibraryEntry } from "@/lib/storage/library";

const uploadStore = stores.uploads;
const scheme = "local:";

type StoredUpload = {
  readonly key: string;
  readonly name: string;
  readonly bytes: ArrayBuffer;
  readonly uploadedAt: number;
};

export function isLocalUrl(url: string): boolean {
  return url.startsWith(scheme);
}

export async function storeUpload(
  name: string,
  bytes: ArrayBuffer,
): Promise<string> {
  const key = crypto.randomUUID();
  await run(uploadStore, "readwrite", (store) =>
    store.put({ key, name, bytes, uploadedAt: Date.now() }),
  );
  return `${scheme}${key}`;
}

export async function readUpload(url: string): Promise<ArrayBuffer> {
  const key = url.slice(scheme.length);
  const stored = await run<StoredUpload | undefined>(
    uploadStore,
    "readonly",
    (store) => store.get(key),
  );
  if (stored === undefined) {
    throw new Error(
      "This file lives on another device and can't be opened here.",
    );
  }
  return stored.bytes;
}

export async function listUploads(): Promise<LibraryEntry[]> {
  const all = await run<StoredUpload[]>(uploadStore, "readonly", (store) =>
    store.getAll(),
  );
  return all
    .map((upload): LibraryEntry => {
      const url = `${scheme}${upload.key}`;
      return {
        key: entryKey("local", url),
        url,
        name: upload.name,
        source: "local",
        playedAt: upload.uploadedAt,
      };
    })
    .sort((left, right) => right.playedAt - left.playedAt);
}

export async function deleteUpload(url: string): Promise<void> {
  await run(uploadStore, "readwrite", (store) =>
    store.delete(url.slice(scheme.length)),
  );
}

export async function clearUploads(): Promise<void> {
  await run(uploadStore, "readwrite", (store) => store.clear());
}
