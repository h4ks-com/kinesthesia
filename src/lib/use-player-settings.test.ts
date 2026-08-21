import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultStart, type PlayerParams } from "@/lib/player-url";
import type { GlobalSettings } from "@/lib/storage/settings";

const global = vi.hoisted(() => ({ value: null as GlobalSettings | null }));
const saved = vi.hoisted(() => ({ global: [] as Partial<GlobalSettings>[] }));

vi.mock("@/lib/storage/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage/settings")>()),
  loadGlobalSettings: () => Promise.resolve(global.value),
  saveGlobalSettings: (next: Partial<GlobalSettings>) => {
    saved.global.push(next);
    return Promise.resolve();
  },
  updateGlobalSettings: (next: Partial<GlobalSettings>) => {
    saved.global.push(next);
    return Promise.resolve();
  },
  loadSongSettings: () => Promise.resolve(null),
  saveSongSettings: () => Promise.resolve(),
}));

const { usePlayerSettings } = await import("@/lib/use-player-settings");

const song: PlayerParams = {
  url: "https://x.test/a.mid",
  name: "a",
  source: null,
  tracks: null,
  speed: 1,
  simplified: false,
  melodyRate: 6,
  hand: null,
  transpose: 0,
  focus: false,
  skin: null,
  rise: false,
  notation: null,
  sheetTheme: null,
  start: defaultStart,
};

function open(params: PlayerParams) {
  return renderHook(() =>
    usePlayerSettings({
      mode: "watch",
      params,
      locked: false,
      getFocus: () => false,
      getView: () => ({ skin: null, rise: false }),
    }),
  );
}

beforeEach(() => {
  global.value = null;
  saved.global = [];
  window.history.replaceState(null, "", "/watch?url=https://x.test/a.mid");
  window.matchMedia = (query: string) =>
    ({ matches: false, media: query }) as MediaQueryList;
});

describe("how a link and a device settle who decides the reading view", () => {
  it("reads the way this device last read where the link says nothing", async () => {
    global.value = {
      notationView: "full",
      sheetTheme: "light",
    } as GlobalSettings;
    const { result } = open(song);
    await waitFor(() => expect(result.current.notationView).toBe("full"));
    expect(result.current.sheetTheme).toBe("light");
  });

  it("reads the way the link asks, over what the device remembers", async () => {
    global.value = {
      notationView: "full",
      sheetTheme: "light",
    } as GlobalSettings;
    const { result } = open({ ...song, notation: "half", sheetTheme: "dark" });
    expect(result.current.notationView).toBe("half");
    // Held past the read that would otherwise have overwritten it.
    await waitFor(() => expect(result.current.keyWidth).toBeDefined());
    expect(result.current.notationView).toBe("half");
    expect(result.current.sheetTheme).toBe("dark");
  });

  it("leaves the device's own choice saved, for the next link that is quiet", async () => {
    global.value = {
      notationView: "full",
      sheetTheme: "light",
    } as GlobalSettings;
    const { result } = open({ ...song, notation: "off" });
    await waitFor(() => expect(result.current.notationView).toBe("off"));
    expect(saved.global.some((write) => "notationView" in write)).toBe(false);
  });

  it("takes each of the three views a link can ask for", async () => {
    for (const view of ["off", "half", "full"] as const) {
      const { result } = open({ ...song, notation: view });
      expect(result.current.notationView).toBe(view);
    }
  });
});
