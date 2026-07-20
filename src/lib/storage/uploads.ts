import { run, stores } from "@/lib/storage/idb";

const uploadStore = stores.uploads;
const scheme = "local:";

type StoredUpload = {
  readonly key: string;
  readonly bytes: ArrayBuffer;
};

export function isLocalUrl(url: string): boolean {
  return url.startsWith(scheme);
}

export async function storeUpload(bytes: ArrayBuffer): Promise<string> {
  const key = crypto.randomUUID();
  await run(uploadStore, "readwrite", (store) => store.put({ key, bytes }));
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
