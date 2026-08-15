import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  chooseVoicing,
  type SavedVoicing,
  useSongVoicing,
} from "@/lib/audio/use-song-voicing";
import type { StoredVoicing, Voicing } from "@/lib/audio/voicing";
import type { PlayerParams } from "@/lib/player-url";
import type { DeviceVoicing } from "@/lib/storage/settings";

const device = vi.hoisted(() => new Map<string, DeviceVoicing>());
const writes = vi.hoisted(() => ({ count: 0, at: 0 }));
/** Milliseconds a read takes, so an answer can be made to arrive after the
 * listener has already said something. */
const slow = vi.hoisted(() => ({ device: 0, server: 0 }));

/** A timer, so a test running on fake ones is not left waiting for a read that
 * was never asked to be slow. */
function slowly<T>(value: T, ms: number): Promise<T> {
  return ms === 0
    ? Promise.resolve(value)
    : new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

vi.mock("@/lib/storage/settings", () => ({
  loadSongVoicing: (url: string) =>
    slowly(device.get(url) ?? null, slow.device),
  saveSongVoicing: (url: string, tracks: StoredVoicing) => {
    writes.count += 1;
    device.set(url, { tracks, updatedAt: writes.at });
    return Promise.resolve();
  },
  forgetSongVoicing: (url: string) => {
    device.delete(url);
    return Promise.resolve();
  },
}));

function entry(authorId: string, updatedAt: number): SavedVoicing {
  return { authorId, authorName: authorId, tracks: new Map(), updatedAt };
}

const newest = entry("bo", 2);
const mine = entry("ana", 1);
const saved = [newest, mine];

describe("chooseVoicing", () => {
  it("plays what you picked this session", () => {
    expect(chooseVoicing(saved, "ana", "bo")).toBe(newest);
  });

  it("plays your own over the newest", () => {
    expect(chooseVoicing(saved, "ana", null)).toBe(mine);
  });

  it("plays the newest for a song you never shaped", () => {
    expect(chooseVoicing(saved, "cass", null)).toBe(newest);
    expect(chooseVoicing(saved, null, null)).toBe(newest);
  });

  it("falls to the file's own instruments when nobody has shaped it", () => {
    expect(chooseVoicing([], "ana", null)).toBeNull();
  });

  it("ignores a pick that is no longer there", () => {
    expect(chooseVoicing(saved, "ana", "gone")).toBe(mine);
  });
});

const song = "https://example.test/a.mid";
const flute: Voicing = {
  program: 73,
  attack: 20,
  release: 300,
  brightness: 8000,
  volume: 90,
};

const params: PlayerParams = {
  url: song,
  name: "A",
  source: "local",
  tracks: null,
  speed: 1,
  simplified: false,
  melodyRate: 1,
  hand: null,
  transpose: 0,
  focus: false,
  skin: null,
  rise: false,
  start: 0,
};

describe("useSongVoicing", () => {
  beforeEach(() => {
    device.clear();
    writes.count = 0;
    slow.device = 0;
    slow.server = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        slowly({ ok: true, json: () => ({ voicings: [] }) }, slow.server),
      ),
    );
  });

  it("asks for a song by url alone, so a provider cannot split it in two", async () => {
    renderHook(() => useSongVoicing(params, null));

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const [address] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(address).toBe(`/api/voicings?url=${encodeURIComponent(song)}`);
  });

  it("keeps an edit on this device", async () => {
    const { result } = renderHook(() => useSongVoicing(params, null));

    act(() => result.current.change(3, flute));

    await waitFor(() => expect(device.get(song)?.tracks).toEqual({ 3: flute }));
  });

  it("comes back to what this device shaped, signed in or not", async () => {
    device.set(song, { tracks: { 3: flute }, updatedAt: 10 });

    const { result } = renderHook(() => useSongVoicing(params, null));

    await waitFor(() => expect(result.current.voicing.get(3)).toEqual(flute));
  });

  it("gives way to a version the account saved later somewhere else", async () => {
    device.set(song, { tracks: { 3: flute }, updatedAt: 10 });
    const account = {
      authorId: "ana",
      authorName: "Ana",
      tracks: { 3: { ...flute, program: 1 } },
      updatedAt: 20,
    };
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => ({ voicings: [account] }),
    } as unknown as Response);

    const { result } = renderHook(() => useSongVoicing(params, "ana"));

    await waitFor(() => expect(result.current.voicing.get(3)?.program).toBe(1));
    expect(device.has(song)).toBe(false);
  });

  it("does not undo an edit made while the device copy was still reading", async () => {
    device.set(song, { tracks: { 3: flute }, updatedAt: 10 });
    slow.device = 40;
    const { result } = renderHook(() => useSongVoicing(params, null));

    act(() => result.current.change(3, { ...flute, program: 1 }));

    await slowly(null, 80);
    expect(result.current.voicing.get(3)?.program).toBe(1);
  });

  it("keeps an edit made while a save was in flight", async () => {
    const { result } = renderHook(() => useSongVoicing(params, "ana"));
    act(() => result.current.change(3, flute));
    await waitFor(() => expect(device.has(song)).toBe(true));
    slow.server = 40;

    let saving: Promise<void> = Promise.resolve();
    act(() => {
      saving = result.current.save();
    });
    act(() => result.current.change(3, { ...flute, program: 1 }));
    await act(() => saving);

    expect(result.current.voicing.get(3)?.program).toBe(1);
  });

  it("writes a drag at both ends of it, not once per step", async () => {
    const { result } = renderHook(() => useSongVoicing(params, null));

    act(() => {
      result.current.change(3, { ...flute, attack: 10 });
      result.current.change(3, { ...flute, attack: 40 });
      result.current.change(3, flute);
    });

    await waitFor(() => expect(device.get(song)?.tracks).toEqual({ 3: flute }));
    expect(writes.count).toBe(2);
  });

  it("writes a single edit before there is anywhere to leave to", async () => {
    const { result } = renderHook(() => useSongVoicing(params, null));

    act(() => result.current.change(3, flute));

    expect(device.get(song)?.tracks).toEqual({ 3: flute });
  });

  it("keeps what was still settling when the song is left", async () => {
    const { result, unmount } = renderHook(() => useSongVoicing(params, null));
    act(() => result.current.change(3, flute));

    unmount();

    await waitFor(() => expect(device.get(song)?.tracks).toEqual({ 3: flute }));
  });

  it("leaves the device copy behind once the account holds it", async () => {
    const { result } = renderHook(() => useSongVoicing(params, "ana"));
    act(() => result.current.change(3, flute));
    await waitFor(() => expect(device.has(song)).toBe(true));

    await act(() => result.current.save());

    expect(device.has(song)).toBe(false);
  });

  it("does not let an edit still settling come back after it is saved", async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useSongVoicing(params, "ana"));
      act(() => result.current.change(3, flute));

      await act(() => result.current.save());
      act(() => vi.advanceTimersByTime(1000));

      expect(device.has(song)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
