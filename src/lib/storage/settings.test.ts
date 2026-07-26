import { beforeEach, describe, expect, it, vi } from "vitest";

/** An in-memory stand-in for the one settings row, with a settable delay so a
 * read can be made to land after a later write starts. */
const row: { value: Record<string, unknown> | undefined } = {
  value: undefined,
};
/** Reads that get slower or faster per call, so an unqueued run of writes can
 * be made to finish out of the order it started in. */
let readDelays: number[] = [];
let reads = 0;

vi.mock("@/lib/storage/idb", () => ({
  stores: { settings: "settings" },
  run: (
    _store: string,
    mode: string,
    action: (store: {
      get: (key: string) => unknown;
      put: (value: Record<string, unknown>) => unknown;
    }) => unknown,
  ) => {
    let captured: Record<string, unknown> | undefined;
    const result = action({
      get: () => row.value,
      put: (value) => {
        captured = value;
        return value;
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
          row.value = captured;
        }
        resolve(result);
      }, settle);
    });
  },
}));

const { loadGlobalSettings, saveGlobalSettings, updateGlobalSettings } =
  await import("@/lib/storage/settings");

beforeEach(() => {
  row.value = undefined;
  readDelays = [];
  reads = 0;
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
