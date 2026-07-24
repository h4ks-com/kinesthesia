import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, unknown>();

vi.mock("@/server/auth", () => ({
  currentViewer: vi.fn(async () => null),
}));
vi.mock("@/server/storage/bucket", () => ({
  bucketEnabled: () => true,
  uploadMidi: vi.fn(async (key: string) => `http://localhost:3000/${key}`),
  putJson: vi.fn(async (key: string, value: unknown) => {
    store.set(key, value);
  }),
  getJson: vi.fn(async (key: string) => store.get(key) ?? null),
}));

const { api } = await import("@/server/api");

function call(name: string, args: Record<string, unknown>) {
  return api.request("/api/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
}

// biome-ignore lint/suspicious/noExplicitAny: test reads dynamic tool JSON
async function json(pending: Response | Promise<Response>): Promise<any> {
  const response = await pending;
  const text = await response.text();
  const line = text
    .split("\n")
    .find((entry) => entry.startsWith("data:") || entry.startsWith("{"));
  const result = JSON.parse((line ?? text).replace(/^data:\s*/, "")).result;
  const payload = result.content[0].text;
  if (result.isError === true) {
    return { isError: true, text: payload };
  }
  return { isError: false, body: JSON.parse(payload) };
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe("project editing over MCP", () => {
  it("creates, adds a progression, and reads it back with channel and harmony", async () => {
    const created = await json(call("create_project", { name: "t", bpm: 90 }));
    expect(created.body.url).toContain("/watch");
    const id = created.body.id;

    await json(
      call("add_chords", {
        id,
        track: "new",
        channel: 1,
        chords: ["Am7", "Dm7", "G7", "Cmaj7"],
      }),
    );
    const dig = await json(call("get_project", { id }));
    expect(dig.body.harmony.map((h: { chord: string }) => h.chord)).toEqual([
      "Am7",
      "Dm7",
      "G7",
      "Cmaj7",
    ]);
    expect(dig.body.tracks[0].channel).toBe(1);
    expect(dig.body.bars).toBe(4);
  });

  it("keeps one stable url across edits", async () => {
    const created = await json(call("create_project", { name: "t" }));
    const id = created.body.id;
    const after = await json(
      call("add_chords", { id, track: "new", chords: ["C"] }),
    );
    expect(after.body.url).toBe(created.body.url);
  });

  it("duplicates a section to extend the piece", async () => {
    const created = await json(call("create_project", {}));
    const id = created.body.id;
    await json(
      call("add_chords", { id, track: "new", chords: ["C", "F", "G", "C"] }),
    );
    const looped = await json(
      call("duplicate", { id, fromBar: 1, toBar: 4, atBar: 5, times: 1 }),
    );
    expect(looped.body.digest.bars).toBe(8);
  });

  it("refuses a transpose that runs off the keyboard", async () => {
    const created = await json(call("create_project", {}));
    const id = created.body.id;
    await json(
      call("add_chords", { id, track: "new", chords: ["C"], octave: 7 }),
    );
    const moved = await json(call("transpose", { id, by: 48 }));
    expect(moved.isError).toBe(true);
  });

  it("appends chords when no bar is given", async () => {
    const created = await json(call("create_project", {}));
    const id = created.body.id;
    await json(call("add_chords", { id, track: "new", chords: ["C", "G"] }));
    const more = await json(
      call("add_chords", { id, track: 0, chords: ["Am", "F"] }),
    );
    expect(more.body.digest.bars).toBe(4);
  });

  it("prepends with insert_bars", async () => {
    const created = await json(call("create_project", {}));
    const id = created.body.id;
    await json(call("add_chords", { id, track: "new", chords: ["C", "G"] }));
    const shifted = await json(call("insert_bars", { id, atBar: 1, bars: 2 }));
    expect(shifted.body.digest.bars).toBe(4);
  });
});
