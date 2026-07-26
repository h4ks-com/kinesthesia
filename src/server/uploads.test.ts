import { Midi } from "@tonejs/midi";
import { beforeEach, describe, expect, it, vi } from "vitest";

const viewer = vi.fn(
  async (): Promise<{ id: string; name: string } | null> => null,
);
const upload = vi.fn(
  async (key: string, _bytes: Uint8Array) => `https://files.test/${key}`,
);
const enabled = vi.fn(() => true);

vi.mock("@/server/auth", () => ({ currentViewer: () => viewer() }));
vi.mock("@/server/storage/bucket", () => ({
  bucketEnabled: () => enabled(),
  uploadMidi: (key: string, bytes: Uint8Array) => upload(key, bytes),
}));

const { api } = await import("@/server/api");

function midiBytes(): Uint8Array {
  const midi = new Midi();
  const track = midi.addTrack();
  track.addNote({ midi: 60, time: 0, duration: 1 });
  return new Uint8Array(midi.toArray());
}

async function post(body: Uint8Array): Promise<Response> {
  return api.request("/api/uploads", {
    method: "POST",
    headers: {
      "content-type": "audio/midi",
      "content-length": String(body.byteLength),
    },
    body: body.slice().buffer as ArrayBuffer,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  viewer.mockResolvedValue(null);
  enabled.mockReturnValue(true);
});

describe("POST /api/uploads", () => {
  it("refuses a caller who is not signed in", async () => {
    const response = await post(midiBytes());
    expect(response.status).toBe(401);
    expect(upload).not.toHaveBeenCalled();
  });

  it("publishes a signed-in player's file and says where it went", async () => {
    viewer.mockResolvedValue({ id: "u1", name: "Player" });
    const response = await post(midiBytes());
    expect(response.status).toBe(200);
    expect((await response.json()).url).toContain("https://files.test/shared/");
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("keeps each file to its own address", async () => {
    viewer.mockResolvedValue({ id: "u1", name: "Player" });
    const first = await (await post(midiBytes())).json();
    const second = await (await post(midiBytes())).json();
    expect(first.url).not.toBe(second.url);
  });

  it("refuses something that is not a MIDI, so a link cannot go out dead", async () => {
    viewer.mockResolvedValue({ id: "u1", name: "Player" });
    const response = await post(new Uint8Array([1, 2, 3, 4]));
    expect(response.status).toBe(400);
    expect(upload).not.toHaveBeenCalled();
  });

  it("refuses an empty body", async () => {
    viewer.mockResolvedValue({ id: "u1", name: "Player" });
    expect((await post(new Uint8Array())).status).toBe(400);
  });

  it("refuses a body larger than the server accepts, before reading it", async () => {
    viewer.mockResolvedValue({ id: "u1", name: "Player" });
    const response = await api.request("/api/uploads", {
      method: "POST",
      headers: {
        "content-type": "audio/midi",
        "content-length": String(50 * 1024 * 1024),
      },
      body: midiBytes().slice().buffer as ArrayBuffer,
    });
    expect(response.status).toBe(413);
    expect(upload).not.toHaveBeenCalled();
  });

  it("stops one account filling the shared store", async () => {
    viewer.mockResolvedValue({ id: "greedy", name: "Player" });
    const codes: number[] = [];
    for (let attempt = 0; attempt < 32; attempt += 1) {
      codes.push((await post(midiBytes())).status);
    }
    expect(codes.filter((code) => code === 200)).toHaveLength(30);
    expect(codes.at(-1)).toBe(429);
  });

  it("says so when the server has no object store", async () => {
    viewer.mockResolvedValue({ id: "u1", name: "Player" });
    enabled.mockReturnValue(false);
    const response = await post(midiBytes());
    expect(response.status).toBe(503);
    expect(upload).not.toHaveBeenCalled();
  });
});
