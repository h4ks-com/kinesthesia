import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SongMenu } from "@/components/song-menu";
import { defaultStart, type PlayerParams } from "@/lib/player-url";

type Row = { key: string; [field: string]: unknown };

const tables = new Map<string, Map<string, Row>>();

vi.mock("@/lib/storage/idb", () => ({
  stores: {
    recent: "recent",
    favourite: "favourite",
    settings: "settings",
    uploads: "uploads",
    pictures: "pictures",
  },
  run: async (
    name: string,
    _mode: string,
    action: (store: {
      get: (key: string) => Row | undefined;
      getAll: () => Row[];
      put: (value: Row) => void;
      delete: (key: string) => void;
    }) => unknown,
  ) => {
    // A real database answers a tick later, which puts a reading and whatever
    // the caller does with it in separate renders.
    await new Promise((done) => setTimeout(done, 0));
    const table = tables.get(name) ?? new Map<string, Row>();
    tables.set(name, table);
    return action({
      get: (key) => table.get(key),
      getAll: () => [...table.values()],
      put: (value) => void table.set(value.key, value),
      delete: (key) => void table.delete(key),
    });
  },
}));

const saved: { blob: Blob | null; filename: string } = {
  blob: null,
  filename: "",
};
// Only the save itself is stood in for: what the file ends up called is the
// behaviour under test, so the real naming runs.
vi.mock(import("@/lib/download"), async (real) => ({
  ...(await real()),
  downloadBlob: (blob: Blob, filename: string) => {
    saved.blob = blob;
    saved.filename = filename;
  },
}));

const song: PlayerParams = {
  url: "https://bitmidi.com/uploads/87216.mid",
  name: "Bohemian Rhapsody.mid",
  source: "bitmidi",
  tracks: null,
  speed: 1,
  simplified: false,
  melodyRate: 6,
  transpose: 0,
  focus: false,
  skin: null,
  rise: false,
  start: defaultStart,
};

const published: string[] = [];

function open(
  params: Partial<PlayerParams> = {},
  props: { signedIn?: boolean; shareEnabled?: boolean } = {},
) {
  const merged = { ...song, ...params };
  render(
    <SongMenu
      mode="watch"
      params={merged}
      title={merged.name.replace(/\.midi?$/i, "")}
      trackCount={3}
      signedIn={props.signedIn ?? true}
      shareEnabled={props.shareEnabled ?? true}
      onPublished={(url) => published.push(url)}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "This song" }));
}

beforeEach(() => {
  tables.clear();
  published.length = 0;
  saved.blob = null;
  saved.filename = "";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([77, 84, 104, 100]).buffer,
      headers: new Headers(),
      json: async () => ({ url: "https://files.test/abc.mid" }),
    })),
  );
});

describe("SongMenu", () => {
  it("hands over the file under the song's own name", async () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: /Download MIDI/ }));
    await waitFor(() => expect(saved.blob).not.toBeNull());
    // The extension the song already carries is not doubled up.
    expect(saved.filename).toBe("Bohemian_Rhapsody.mid");
    expect(saved.blob?.type).toBe("audio/midi");
  });

  it("remembers the song and says so", async () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: /^Favorite/ }));
    await screen.findByRole("button", { name: /Remove favorite/ });
    expect([...(tables.get("favourite")?.keys() ?? [])]).toEqual([
      "bitmidi:https://bitmidi.com/uploads/87216.mid",
    ]);
  });

  // A file kept on this device resolves nowhere else, so there is no link to
  // hand out until it has been put online.
  it("offers no link for a file held on this device", () => {
    open({ url: "local:abc-123", source: "local" });
    expect(screen.queryByRole("button", { name: /Copy link/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Put it online/ })).toBeTruthy();
  });

  // Where it landed goes to whoever owns the address the page is on, so every
  // control that asks whether the song can be shared reads one url.
  it("reports where a published file landed", async () => {
    tables.set(
      "uploads",
      new Map([
        [
          "abc-123",
          {
            key: "abc-123",
            name: "mine.mid",
            bytes: new ArrayBuffer(8),
            uploadedAt: 1,
          },
        ],
      ]),
    );
    open({ url: "local:abc-123", source: "local" });
    fireEvent.click(screen.getByRole("button", { name: /Put it online/ }));
    await waitFor(() =>
      expect(published).toEqual(["https://files.test/abc.mid"]),
    );
  });
});
