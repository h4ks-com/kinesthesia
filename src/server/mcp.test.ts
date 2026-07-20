import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth", () => ({
  currentViewer: vi.fn(async () => null),
}));

vi.mock("@/server/midi/analyse", () => ({
  analyseMidi: vi.fn(async (url: string, name: string) => {
    if (url.includes("missing")) {
      throw new Error("Could not download that MIDI (status 404)");
    }
    return {
      name,
      duration: 12.5,
      notes: 40,
      tracks: [
        {
          index: 0,
          name: "piano",
          instrument: "acoustic grand piano",
          percussion: false,
          notes: 40,
        },
      ],
      playedTrack: 0,
      lowestPitch: 48,
      highestPitch: 72,
      density: 3.2,
    };
  }),
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
      learnUrl: "https://kinesthesia.h4ks.com/learn?url=x",
      multiplayerUrl: "https://kinesthesia.h4ks.com/multiplayer?url=x",
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
    expect(match.learnUrl).toContain("/learn");
    expect(match.multiplayerUrl).toContain("/multiplayer");
  });
});

describe("player_link", () => {
  async function build(args: Record<string, unknown>) {
    const response = await rpc("tools/call", {
      name: "player_link",
      arguments: args,
    });
    const body = await result(response);
    const content = body.content as { text: string }[];
    return { text: content[0]?.text ?? "", isError: body.isError === true };
  }

  it("is offered alongside the search", async () => {
    const tools = (await result(await rpc("tools/list"))).tools as {
      name: string;
    }[];
    expect(tools.map((entry) => entry.name)).toContain("player_link");
  });

  it("carries every setting the player reads", async () => {
    const { text } = await build({
      url: "https://bitmidi.com/uploads/87216.mid",
      name: "Queen - Bohemian Rhapsody.mid",
      source: "bitmidi",
      mode: "watch",
      tracks: [4],
      speed: 1,
      simplified: true,
      melodyRate: 7,
      transpose: 0,
      focus: true,
      start: 90,
    });

    expect(text).toContain("/watch?");
    expect(text).toContain("tracks=4");
    expect(text).toContain("simple=1");
    expect(text).toContain("rate=7");
    expect(text).toContain("focus=1");
    expect(text).toContain("start=90");
  });

  it("refuses an offset before the beginning", async () => {
    const { isError } = await build({
      url: "https://bitmidi.com/uploads/87216.mid",
      mode: "watch",
      start: -5,
    });

    expect(isError).toBe(true);
  });

  it("opens a song plainly when nothing is asked for", async () => {
    const { text } = await build({
      url: "https://bitmidi.com/uploads/87216.mid",
      mode: "learn",
    });

    expect(text).toContain("/learn?");
    expect(text).not.toContain("focus");
    expect(text).not.toContain("simple");
  });

  // A setting left out defers to what the listener's device remembers, so one
  // that was named has to be written down even at its default.
  it("writes down a setting that was named even at its default", async () => {
    const { text } = await build({
      url: "https://bitmidi.com/uploads/1.mid",
      speed: 1,
      transpose: 0,
      simplified: false,
    });

    expect(text).toContain("speed=1");
    expect(text).toContain("transpose=0");
    expect(text).toContain("simple=0");
  });

  it("holds a key inside what the player accepts", async () => {
    const { text } = await build({
      url: "https://bitmidi.com/uploads/1.mid",
      transpose: 99,
    });
    expect(text).toContain("transpose=12");
  });

  it("refuses a speed the player has no setting for", async () => {
    const { text, isError } = await build({
      url: "https://bitmidi.com/uploads/1.mid",
      speed: 3,
    });
    expect(isError).toBe(true);
    expect(text).toContain("speed must be one of");
  });

  it("refuses to strip the chrome off a mode that scores", async () => {
    const { isError } = await build({
      url: "https://bitmidi.com/uploads/1.mid",
      mode: "learn",
      focus: true,
    });
    expect(isError).toBe(true);
  });
});

describe("midi_info", () => {
  it("is offered alongside the other tools", async () => {
    const tools = (await result(await rpc("tools/list"))).tools as {
      name: string;
    }[];
    expect(tools.map((entry) => entry.name)).toContain("midi_info");
  });

  it("reports the length and the tracks", async () => {
    const response = await rpc("tools/call", {
      name: "midi_info",
      arguments: { url: "https://bitmidi.com/uploads/1.mid", name: "A song" },
    });
    const content = (await result(response)).content as { text: string }[];
    const summary = JSON.parse(content[0]?.text ?? "{}");

    expect(summary.duration).toBe(12.5);
    expect(summary.tracks[0].name).toBe("piano");
    expect(summary.playedTrack).toBe(0);
  });

  it("says so when the file cannot be read", async () => {
    const response = await rpc("tools/call", {
      name: "midi_info",
      arguments: { url: "https://bitmidi.com/uploads/missing.mid" },
    });
    const body = await result(response);
    expect(body.isError).toBe(true);
    expect((body.content as { text: string }[])[0]?.text).toContain("404");
  });
});
