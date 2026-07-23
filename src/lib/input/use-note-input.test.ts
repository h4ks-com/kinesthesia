import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useNoteInput } from "@/lib/input/use-note-input";

function keydown(target: EventTarget, code: string): void {
  target.dispatchEvent(
    new KeyboardEvent("keydown", { code, bubbles: true, cancelable: true }),
  );
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useNoteInput text-field guard", () => {
  it("plays a note when a key is pressed with nothing focused", () => {
    const onPress = vi.fn();
    renderHook(() => useNoteInput({ active: true, onPress }));
    keydown(document.body, "KeyV");
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("does not play a note while a text field is focused", () => {
    const onPress = vi.fn();
    renderHook(() => useNoteInput({ active: true, onPress }));
    const search = document.createElement("input");
    search.type = "search";
    document.body.append(search);
    keydown(search, "KeyV");
    expect(onPress).not.toHaveBeenCalled();
  });
});
