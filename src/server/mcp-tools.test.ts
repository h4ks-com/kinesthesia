import { beforeEach, describe, expect, it, vi } from "vitest";
import { addChords, createProject, projectBytes } from "@/lib/midi/project";

vi.mock("@/server/auth", () => ({
  currentViewer: vi.fn(async () => null),
}));
vi.mock("@/server/storage/bucket", () => ({
  bucketEnabled: () => true,
  uploadMidi: vi.fn(async (key: string) => `http://localhost:3000/${key}`),
}));
vi.mock("@/server/http/fetch", () => ({
  sourceFetch: vi.fn(),
}));

const { api } = await import("@/server/api");
const { sourceFetch } = await import("@/server/http/fetch");

const knownSong = projectBytes(
  addChords(createProject("fixture", { bpm: 120 }), {
    track: "new",
    chords: ["C", "G", "Am", "F"],
    style: "block",
  }),
);

function rpc(name: string, args: Record<string, unknown>) {
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

async function body(response: Response) {
  const text = await response.text();
  const line = text
    .split("\n")
    .find((entry) => entry.startsWith("data:") || entry.startsWith("{"));
  return JSON.parse((line ?? text).replace(/^data:\s*/, "")).result;
}

async function firstText(
  response: Response,
): Promise<{ text: string; isError: boolean }> {
  const result = await body(response);
  const content = result.content as { text: string }[];
  return { text: content[0]?.text ?? "", isError: result.isError === true };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(sourceFetch).mockResolvedValue(
    new Response(new Uint8Array(knownSong), { status: 200 }),
  );
});

describe("new editing tools", () => {
  it("offers analyze_midi, make_text and arpeggiate", async () => {
    const response = await api.request("/api/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      }),
    });
    const names = ((await body(response)).tools as { name: string }[]).map(
      (entry) => entry.name,
    );
    expect(names).toEqual(
      expect.arrayContaining(["analyze_midi", "make_text", "arpeggiate"]),
    );
  });

  it("analyze_midi reports tempo, key and the chord timeline", async () => {
    const { text } = await firstText(
      await rpc("analyze_midi", { source: "bitmidi", id: "1", name: "known" }),
    );
    const found = JSON.parse(text);
    expect(found.tempo.bpm).toBe(120);
    expect(found.key.tonic).toBe("C");
    expect(found.key.mode).toBe("major");
    expect(found.harmony[0].chord).toBe("CM");
  });

  it("make_text returns a player link and the raw file url", async () => {
    const { text, isError } = await firstText(
      await rpc("make_text", { text: "HI" }),
    );
    expect(isError).toBe(false);
    const links = JSON.parse(text);
    expect(links.playUrl).toContain("/api/g/");
    expect(links.downloadUrl).toContain("gen/");
  });

  it("arpeggiate builds links from valid chords", async () => {
    const { text, isError } = await firstText(
      await rpc("arpeggiate", { chords: ["Cmaj7", "G7"], bpm: 90 }),
    );
    expect(isError).toBe(false);
    expect(JSON.parse(text).playUrl).toContain("/api/g/");
  });

  it("arpeggiate refuses a chord symbol it cannot read", async () => {
    const { text, isError } = await firstText(
      await rpc("arpeggiate", { chords: ["Cmaj7", "Zzz"] }),
    );
    expect(isError).toBe(true);
    expect(text).toContain("unknown chord");
  });
});
