import { run, stores } from "@/lib/storage/idb";
import { entryKey, type LibraryEntry } from "@/lib/storage/library";

const uploadStore = stores.uploads;
const scheme = "local:";

type StoredUpload = {
  readonly key: string;
  readonly name: string;
  readonly bytes: ArrayBuffer;
  readonly uploadedAt: number;
  /** Where the file was published, once it has been. From then on the library
   * hands out that url, so the file plays for anyone the link reaches and the
   * modes that need a fetchable address work on it. */
  readonly sharedUrl?: string;
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
      const url = upload.sharedUrl ?? `${scheme}${upload.key}`;
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

/** Takes either address a row can carry, since a published file is listed under
 * the url it was given rather than the one it is stored against. */
export async function deleteUpload(url: string): Promise<void> {
  const key = await storeKeyFor(url);
  if (key === null) {
    return;
  }
  await run(uploadStore, "readwrite", (store) => store.delete(key));
}

async function storeKeyFor(url: string): Promise<string | null> {
  if (isLocalUrl(url)) {
    return url.slice(scheme.length);
  }
  const all = await run<StoredUpload[]>(uploadStore, "readonly", (store) =>
    store.getAll(),
  );
  return all.find((upload) => upload.sharedUrl === url)?.key ?? null;
}

export async function clearUploads(): Promise<void> {
  await run(uploadStore, "readwrite", (store) => store.clear());
}

/** Records where a file was published. The local bytes stay, so the row keeps
 * playing from this device without waiting on the network. */
export async function markShared(
  url: string,
  sharedUrl: string,
): Promise<void> {
  const key = await storeKeyFor(url);
  const stored =
    key === null
      ? undefined
      : await run<StoredUpload | undefined>(uploadStore, "readonly", (store) =>
          store.get(key),
        );
  if (stored === undefined) {
    return;
  }
  await run(uploadStore, "readwrite", (store) =>
    store.put({ ...stored, sharedUrl }),
  );
}
