import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  key: string;
  name: string;
  bytes: ArrayBuffer;
  uploadedAt: number;
  sharedUrl?: string;
};

const rows = new Map<string, Row>();

vi.mock("@/lib/storage/idb", () => ({
  stores: { uploads: "uploads" },
  run: async (
    _store: string,
    _mode: string,
    action: (store: {
      get: (key: string) => Row | undefined;
      getAll: () => Row[];
      put: (value: Row) => void;
      delete: (key: string) => void;
    }) => unknown,
  ) =>
    action({
      get: (key) => rows.get(key),
      getAll: () => [...rows.values()],
      put: (value) => {
        rows.set(value.key, value);
      },
      delete: (key) => {
        rows.delete(key);
      },
    }),
}));

const { deleteUpload, listUploads, markShared, storeUpload } = await import(
  "@/lib/storage/uploads"
);

beforeEach(() => {
  rows.clear();
});

describe("uploads", () => {
  it("lists a file under its local address until it is published", async () => {
    await storeUpload("mine.mid", new ArrayBuffer(8));
    const [entry] = await listUploads();
    expect(entry?.url.startsWith("local:")).toBe(true);
  });

  it("hands out the published address once there is one", async () => {
    const local = await storeUpload("mine.mid", new ArrayBuffer(8));
    await markShared(local.slice("local:".length), "https://files.test/a.mid");

    const [entry] = await listUploads();
    expect(entry?.url).toBe("https://files.test/a.mid");
  });

  it("removes a published row, which is no longer listed under the key it is stored against", async () => {
    const local = await storeUpload("mine.mid", new ArrayBuffer(8));
    await markShared(local.slice("local:".length), "https://files.test/a.mid");

    const [entry] = await listUploads();
    await deleteUpload(entry?.url ?? "");
    expect(await listUploads()).toHaveLength(0);
  });

  it("still removes one that was never published", async () => {
    const local = await storeUpload("mine.mid", new ArrayBuffer(8));
    await deleteUpload(local);
    expect(await listUploads()).toHaveLength(0);
  });
});
