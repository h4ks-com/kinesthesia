import { beforeEach, describe, expect, it, vi } from "vitest";

/** An in-memory stand-in for the stores, with a settable delay so a read can be
 * made to land after a later write starts. Rows are held under the store they
 * were written to, since that is what keeps two key schemes apart. */
const rows = new Map<string, Record<string, unknown>>();
/** Reads that get slower or faster per call, so an unqueued run of writes can
 * be made to finish out of the order it started in. */
let readDelays: number[] = [];
let reads = 0;

vi.mock("@/lib/storage/idb", () => ({
  stores: { settings: "settings", voicings: "voicings" },
  run: (
    store: string,
    mode: string,
    action: (store: {
      get: (key: string) => unknown;
      put: (value: Record<string, unknown>) => unknown;
      delete: (key: string) => unknown;
    }) => unknown,
  ) => {
    let captured: Record<string, unknown> | undefined;
    let dropped: string | null = null;
    const result = action({
      get: (key) => rows.get(`${store}/${key}`),
      put: (value) => {
        captured = value;
        return value;
      },
      delete: (key) => {
        dropped = `${store}/${key}`;
        return undefined;
      },
    });
    let settle = 0;
    if (mode !== "readwrite") {
      settle = readDelays[reads] ?? 0;
      reads += 1;
    }
    return new Promise((resolve) => {
      setTimeout(() => {
        if (captured !== undefined) {
          rows.set(`${store}/${String(captured.key)}`, captured);
        }
        if (dropped !== null) {
          rows.delete(dropped);
        }
        resolve(result);
      }, settle);
    });
  },
}));

const {
  forgetSongVoicing,
  loadGlobalSettings,
  loadSongSettings,
  loadSongVoicing,
  saveGlobalSettings,
  saveSongSettings,
  saveSongVoicing,
  songSettingsKey,
  updateGlobalSettings,
} = await import("@/lib/storage/settings");

beforeEach(() => {
  rows.clear();
  readDelays = [];
  reads = 0;
});

describe("song voicing", () => {
  const song = "https://example.test/a.mid";
  const other = "https://example.test/b.mid";
  const flute = {
    program: 73,
    attack: 20,
    release: 300,
    brightness: 8000,
    volume: 90,
  };

  it("comes back for the song it was shaped on", async () => {
    await saveSongVoicing(song, { 3: flute });
    await saveSongVoicing(other, {});

    expect((await loadSongVoicing(song))?.tracks).toEqual({ 3: flute });
    expect((await loadSongVoicing(other))?.tracks).toEqual({});
  });

  it("tells a song nobody shaped from one shaped to sound as written", async () => {
    await saveSongVoicing(song, {});

    expect((await loadSongVoicing(song))?.tracks).toEqual({});
    expect(await loadSongVoicing(other)).toBeNull();
  });

  it("is gone once forgotten", async () => {
    await saveSongVoicing(song, { 3: flute });
    await forgetSongVoicing(song);

    expect(await loadSongVoicing(song)).toBeNull();
  });

  // A link states the provider, so one naming itself `voicing` could reach the
  // key a voicing was written under while the two shared a store.
  it("is out of reach of a song settings key", async () => {
    await saveSongVoicing(song, { 3: flute });
    await saveSongSettings(songSettingsKey("voicing", song), {
      speed: 1,
      tracks: [0, 2],
      simplified: false,
      melodyRate: 1,
    });

    expect((await loadSongVoicing(song))?.tracks).toEqual({ 3: flute });
    expect(
      (await loadSongSettings(songSettingsKey("voicing", song)))?.tracks,
    ).toEqual([0, 2]);
  });
});

describe("updateGlobalSettings", () => {
  it("leaves the settings it was not given alone", async () => {
    await saveGlobalSettings({ keyWidth: 40, latencyOffset: 120 });
    await updateGlobalSettings({ keyWidth: 65 });

    const stored = await loadGlobalSettings();
    expect(stored?.keyWidth).toBe(65);
    expect(stored?.latencyOffset).toBe(120);
  });

  it("lands the last of a run of overlapping writes, not whichever read first", async () => {
    await saveGlobalSettings({ keyWidth: 40, latencyOffset: 120 });

    // A dragged slider fires a write per step. The last step's read returns
    // first here, so unqueued the earliest step saves last and the slider
    // springs back to where the drag began.
    readDelays = [0, 30, 20, 10];
    await Promise.all([
      updateGlobalSettings({ keyWidth: 50 }),
      updateGlobalSettings({ keyWidth: 60 }),
      updateGlobalSettings({ keyWidth: 70 }),
    ]);

    const stored = await loadGlobalSettings();
    expect(stored?.keyWidth).toBe(70);
    expect(stored?.latencyOffset).toBe(120);
  });

  it("keeps a setting written by another owner mid-run", async () => {
    await saveGlobalSettings({ keyWidth: 40, latencyOffset: 120 });
    readDelays = [0, 30, 10];

    const widths = updateGlobalSettings({ keyWidth: 55 });
    const latency = updateGlobalSettings({ latencyOffset: 200 });
    await Promise.all([widths, latency]);

    const stored = await loadGlobalSettings();
    expect(stored?.keyWidth).toBe(55);
    expect(stored?.latencyOffset).toBe(200);
  });
});
