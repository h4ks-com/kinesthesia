import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth", () => ({
  currentViewer: vi.fn(async () => null),
}));

vi.mock("@/server/midi/search", () => ({
  searchMidi: vi.fn(async () => [
    {
      id: "1",
      source: "bitmidi",
      name: "A song.mid",
      plays: 1,
      downloadUrl: "https://bitmidi.com/uploads/1.mid",
      sourceUrl: "https://bitmidi.com/a-song-mid",
      playUrl: "https://kinesthesia.h4ks.com/watch?url=x",
    },
  ]),
}));

const { api } = await import("@/server/api");

function rpc(method: string, params: Record<string, unknown> = {}) {
  return api.request("/api/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

async function result(response: Response) {
  const body = await response.text();
  const line = body
    .split("\n")
    .find((entry) => entry.startsWith("data:") || entry.startsWith("{"));
  return JSON.parse((line ?? body).replace(/^data:\s*/, "")).result;
}

describe("mcp endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists its tools without an initialize handshake", async () => {
    const response = await rpc("tools/list");
    expect(response.status).toBe(200);
    const tools = (await result(response)).tools as { name: string }[];
    expect(tools.map((entry) => entry.name)).toContain("search_midi");
  });

  // A shared server would bind to the first transport and reject every request
  // after it, which is how this endpoint shipped broken.
  it("serves repeated requests", async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await rpc("tools/list")).status).toBe(200);
    }
  });

  it("tells the caller what kinesthesia is", async () => {
    const response = await rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    expect((await result(response)).instructions).toContain("/learn");
  });

  it("searches and returns a download link and a player link", async () => {
    const response = await rpc("tools/call", {
      name: "search_midi",
      arguments: { q: "a song", limit: 1 },
    });
    expect(response.status).toBe(200);
    const content = (await result(response)).content as { text: string }[];
    const first = content[0];
    if (first === undefined) {
      throw new Error("the tool returned no content");
    }
    const [match] = JSON.parse(first.text).results;
    expect(match.downloadUrl).toMatch(/\.mid$/);
    expect(match.playUrl).toContain("/watch");
  });
});
