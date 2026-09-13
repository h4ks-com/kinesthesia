import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { rolandDataSet } from "@/lib/input/sysex-fixtures";
import type { BackgroundChoice } from "@/lib/skins/backdrop";

/** Settings as a row on disk, which may predate the current binding shape. */
const stored = vi.hoisted(() => ({
  value: null as { midiShortcuts: unknown } | null,
}));

vi.mock("@/lib/storage/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage/settings")>()),
  loadGlobalSettings: () => Promise.resolve(stored.value),
  updateGlobalSettings: () => Promise.resolve(),
}));

const { useMidiShortcuts } = await import("@/lib/input/midi-shortcuts");

const starfield: BackgroundChoice = { kind: "built-in", id: "starfield" };
const aurora: BackgroundChoice = { kind: "built-in", id: "aurora" };

function genosBody(value: number): number[] {
  return [0x43, 0x10, 0x4c, 0x10, 0x00, 0x0b, value];
}

function mount() {
  const onTrigger = vi.fn();
  const { result } = renderHook(() =>
    useMidiShortcuts({ onTrigger, targets: () => [starfield, aurora, null] }),
  );
  return { result, onTrigger };
}

beforeEach(() => {
  stored.value = null;
});

describe("SysEx controls bound to backgrounds", () => {
  it("binds a slider once it has moved, and picks by its position", () => {
    const { result, onTrigger } = mount();
    act(() => result.current.beginLearnSlider());
    act(() =>
      result.current.onControl({ kind: "sysex", body: rolandDataSet(10) }),
    );
    expect(result.current.bindings).toEqual([]);
    act(() =>
      result.current.onControl({ kind: "sysex", body: rolandDataSet(11) }),
    );
    expect(result.current.learning).toBeNull();
    expect(result.current.sysexListening().patterns).toHaveLength(1);

    act(() =>
      result.current.onControl({ kind: "sysex", body: rolandDataSet(0) }),
    );
    act(() =>
      result.current.onControl({ kind: "sysex", body: rolandDataSet(127) }),
    );
    expect(onTrigger.mock.calls).toEqual([[starfield], [null]]);
  });

  it("binds a button to the one message it sends", () => {
    const { result, onTrigger } = mount();
    const press = [0x42, 0x30, 0x00, 0x01, 0x2c, 0x7f];
    act(() => result.current.beginLearnButton(aurora));
    act(() => result.current.onControl({ kind: "sysex", body: press }));
    act(() =>
      result.current.onControl({
        kind: "sysex",
        body: [0x42, 0x30, 0x00, 0x01, 0x2c, 0x00],
      }),
    );
    act(() => result.current.onControl({ kind: "sysex", body: press }));
    expect(onTrigger.mock.calls).toEqual([[aurora]]);
  });

  it("refuses a button on a position of the bound slider", () => {
    const { result } = mount();
    act(() => result.current.beginLearnSlider());
    act(() => result.current.onControl({ kind: "sysex", body: genosBody(10) }));
    act(() => result.current.onControl({ kind: "sysex", body: genosBody(11) }));
    act(() => result.current.beginLearnButton(aurora));
    act(() => result.current.onControl({ kind: "sysex", body: genosBody(64) }));
    expect(result.current.conflict).toBe("taken");
    expect(result.current.bindings).toHaveLength(1);
  });

  it("keeps a slider saved as a Yamaha address working", async () => {
    stored.value = {
      midiShortcuts: [
        {
          kind: "slider",
          control: { kind: "sysex", key: [0x43, 0x10, 0x4c, 0x10, 0x00, 0x0b] },
        },
      ],
    };
    const { result, onTrigger } = mount();
    await waitFor(() => expect(result.current.bindings).toHaveLength(1));
    act(() => result.current.onControl({ kind: "sysex", body: genosBody(60) }));
    expect(onTrigger.mock.calls).toEqual([[aurora]]);
  });
});
