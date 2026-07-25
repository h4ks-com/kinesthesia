import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { usePlayNotes } from "@/lib/play/use-play-notes";

/** A clock the test drives by hand, read live through the hook's ref. */
function clock() {
  const now = { value: 0 };
  return { now, read: () => now.value };
}

describe("usePlayNotes", () => {
  it("opens a note at the current position and closes it on release", () => {
    const { now, read } = clock();
    const { result } = renderHook(() => usePlayNotes(read));

    now.value = 1.5;
    result.current.emit(60, 0, 0.8);
    const open = result.current.get();
    expect(open).toHaveLength(1);
    expect(open[0]?.start).toBe(1.5);
    expect(open[0]?.end).toBeNull();

    now.value = 2.5;
    result.current.damp(60, 0);
    expect(result.current.get()[0]?.end).toBe(2.5);
  });

  it("closes a still-open note when the same key is struck again", () => {
    const { now, read } = clock();
    const { result } = renderHook(() => usePlayNotes(read));

    result.current.emit(60, 0, 0.8);
    now.value = 0.5;
    result.current.emit(60, 0, 0.8);

    const notes = result.current.get();
    expect(notes).toHaveLength(2);
    expect(notes[0]?.end).toBe(0.5);
    expect(notes[1]?.end).toBeNull();
  });

  it("keeps the same pitch on two parts apart", () => {
    const { read } = clock();
    const { result } = renderHook(() => usePlayNotes(read));

    result.current.emit(60, 0, 0.8);
    result.current.emit(60, 1, 0.8);
    result.current.damp(60, 0);

    const notes = result.current.get();
    expect(notes.find((note) => note.track === 0)?.end).toBe(0);
    expect(notes.find((note) => note.track === 1)?.end).toBeNull();
  });

  it("drops a released note only once it has climbed off screen", () => {
    const { now, read } = clock();
    const { result } = renderHook(() => usePlayNotes(read));

    result.current.emit(60, 0, 0.8);
    result.current.damp(60, 0);

    now.value = 4.4;
    expect(result.current.get()).toHaveLength(1);

    now.value = 4.6;
    expect(result.current.get()).toHaveLength(0);
  });

  it("stops the bar at the lift but keeps the note sounding under the pedal", () => {
    const { now, read } = clock();
    const { result } = renderHook(() => usePlayNotes(read));

    result.current.emit(60, 0, 0.8);
    now.value = 1;
    result.current.lift(60, 0);

    const lifted = result.current.get()[0];
    expect(lifted?.end).toBe(1);
    expect(lifted?.release).toBeNull();

    now.value = 3;
    result.current.damp(60, 0);
    const damped = result.current.get()[0];
    expect(damped?.end).toBe(1);
    expect(damped?.release).toBe(3);
  });

  it("closes a note damped without a lift, so a pedal-only release still ends it", () => {
    const { now, read } = clock();
    const { result } = renderHook(() => usePlayNotes(read));

    result.current.emit(60, 0, 0.8);
    now.value = 2;
    result.current.damp(60, 0);
    expect(result.current.get()[0]?.end).toBe(2);
  });

  it("never drops a note that is still held", () => {
    const { now, read } = clock();
    const { result } = renderHook(() => usePlayNotes(read));

    result.current.emit(60, 0, 0.8);
    now.value = 100;
    expect(result.current.get()).toHaveLength(1);
  });
});
