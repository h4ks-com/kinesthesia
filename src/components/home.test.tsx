import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Home } from "@/components/home";

type Row = { key: string; [field: string]: unknown };

const tables = new Map<string, Map<string, Row>>();

// The real library and upload modules run over this, so a test sees the same
// row identities the browser does, which is what makes a published file arrive
// as a new row rather than an updated one.
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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/",
}));

function mine() {
  return render(
    <Home
      viewer={{ id: "1", name: "me" }}
      authEnabled={true}
      shareEnabled={true}
      homeLink="https://h4ks.test"
      chatLink="https://chat.test"
      signIn={async () => undefined}
      signOut={async () => undefined}
    />,
  );
}

beforeEach(() => {
  tables.clear();
  tables.set(
    "uploads",
    new Map([
      [
        "abc",
        {
          key: "abc",
          name: "mine.mid",
          bytes: new ArrayBuffer(8),
          uploadedAt: 1,
        },
      ],
    ]),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (target: string) => ({
      ok: target === "/api/uploads",
      json: async () => ({ url: "https://files.test/abc.mid" }),
    })),
  );
});

describe("Home", () => {
  it("hands the focus to the copy control once a file is online", async () => {
    mine();
    fireEvent.click(
      await screen.findByRole("button", { name: "Put mine.mid online" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "put it online" }));

    const copy = await screen.findByRole("button", {
      name: "Copy the link to mine.mid",
    });
    await waitFor(() => expect(document.activeElement).toBe(copy));
  });

  it("keeps the focus in the search box while the library is filtered", async () => {
    mine();
    await screen.findByRole("button", { name: "Put mine.mid online" });
    fireEvent.click(
      screen.getByRole("button", { name: "Put mine.mid online" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "put it online" }));
    await screen.findByRole("button", { name: "Copy the link to mine.mid" });

    const box = screen.getByRole("textbox", {
      name: "Search for a song, or paste a link",
    });
    box.focus();
    // Filtering the row out and back in mounts it again, which is where a row
    // that focuses itself on arrival takes the box away from whoever is typing.
    fireEvent.change(box, { target: { value: "zzz" } });
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Copy the link to mine.mid" }),
      ).toBeNull(),
    );
    fireEvent.change(box, { target: { value: "" } });
    await screen.findByRole("button", { name: "Copy the link to mine.mid" });
    expect(document.activeElement).toBe(box);
  });
});
