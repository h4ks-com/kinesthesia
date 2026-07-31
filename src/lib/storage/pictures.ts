import { run, stores } from "@/lib/storage/idb";

const pictureStore = stores.pictures;
const scheme = "local:";

export type StoredPicture = {
  readonly key: string;
  readonly name: string;
  /** The picture itself, kept whole so it survives a reload. */
  readonly bytes: ArrayBuffer;
  readonly type: string;
  readonly addedAt: number;
};

export type Picture = {
  /** The `local:` address a background parameter refers to it by. */
  readonly source: string;
  readonly name: string;
  readonly addedAt: number;
};

/** Pictures stay on the device that added them. A background parameter naming
 * one resolves nowhere else, which is the trade for never uploading a file
 * somebody only wanted behind their own roll. */
export function isLocalPicture(source: string): boolean {
  return source.startsWith(scheme);
}

export async function storePicture(
  name: string,
  bytes: ArrayBuffer,
  type: string,
): Promise<string> {
  const key = crypto.randomUUID();
  await run(pictureStore, "readwrite", (store) =>
    store.put({ key, name, bytes, type, addedAt: Date.now() }),
  );
  return `${scheme}${key}`;
}

export async function listPictures(): Promise<readonly Picture[]> {
  const rows = await run<StoredPicture[]>(pictureStore, "readonly", (store) =>
    store.getAll(),
  );
  return rows
    .map((row) => ({
      source: `${scheme}${row.key}`,
      name: row.name,
      addedAt: row.addedAt,
    }))
    .sort((left, right) => right.addedAt - left.addedAt);
}

export async function deletePicture(source: string): Promise<void> {
  await run(pictureStore, "readwrite", (store) =>
    store.delete(source.slice(scheme.length)),
  );
}

/** An address the page can actually load the picture from. The object url is
 * the caller's to revoke, since only they know when it stops being drawn. */
export async function pictureHref(source: string): Promise<string | null> {
  if (!isLocalPicture(source)) {
    return source;
  }
  const row = await run<StoredPicture | undefined>(
    pictureStore,
    "readonly",
    (store) => store.get(source.slice(scheme.length)),
  );
  if (row === undefined) {
    return null;
  }
  return URL.createObjectURL(new Blob([row.bytes], { type: row.type }));
}
