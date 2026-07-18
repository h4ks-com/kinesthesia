"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  clampOctave,
  defaultOctave,
  octaveDownCodes,
  octaveUpCodes,
  pitchForCode,
} from "@/lib/input/keyboard-map";
import { connectMidiInputs, isWebMidiSupported } from "@/lib/input/web-midi";

export type InputStatus = "midi" | "keyboard";

export type NoteInput = {
  octave: number;
  setOctave: (octave: number) => void;
  status: InputStatus;
  pressed: () => ReadonlySet<number>;
  press: (pitch: number, velocity: number, at?: number) => void;
  release: (pitch: number) => void;
};

type Options = {
  active: boolean;
  onPress: (pitch: number, velocity: number, at: number) => void;
  onRelease?: (pitch: number) => void;
  onToggle: () => void;
};

const textInputTypes = new Set([
  "text",
  "search",
  "email",
  "url",
  "password",
  "number",
  "tel",
]);

/** Where the spacebar types a character, so play must not steal it. A button,
 * slider or track toggle is not one of these, which is what lets space stay
 * play everywhere else. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  if (target instanceof HTMLTextAreaElement) {
    return true;
  }
  return target instanceof HTMLInputElement && textInputTypes.has(target.type);
}

export function useNoteInput({
  active,
  onPress,
  onRelease,
  onToggle,
}: Options): NoteInput {
  const [octave, setOctave] = useState(defaultOctave);
  const [status, setStatus] = useState<InputStatus>("keyboard");
  const pressedRef = useRef<Set<number>>(new Set());
  const octaveRef = useRef(octave);
  octaveRef.current = octave;
  const pressRef = useRef(onPress);
  pressRef.current = onPress;
  const toggleRef = useRef(onToggle);
  toggleRef.current = onToggle;
  const releaseRef = useRef(onRelease);
  releaseRef.current = onRelease;

  const press = useCallback((pitch: number, velocity: number, at?: number) => {
    pressedRef.current.add(pitch);
    pressRef.current(pitch, velocity, at ?? performance.now());
  }, []);

  const release = useCallback((pitch: number) => {
    pressedRef.current.delete(pitch);
    releaseRef.current?.(pitch);
  }, []);

  useEffect(() => {
    const onDown = (event: KeyboardEvent) => {
      if (event.repeat) {
        return;
      }
      if (event.code === "Space") {
        if (isTextEntry(event.target)) {
          return;
        }
        // Space is play everywhere else, so preventDefault stops a focused
        // button or track toggle from firing on the key instead.
        event.preventDefault();
        toggleRef.current();
        return;
      }
      if (!active) {
        return;
      }
      if (octaveDownCodes.has(event.code)) {
        event.preventDefault();
        setOctave((current) => clampOctave(current - 1));
        return;
      }
      if (octaveUpCodes.has(event.code)) {
        event.preventDefault();
        setOctave((current) => clampOctave(current + 1));
        return;
      }
      const pitch = pitchForCode(event.code, octaveRef.current);
      if (pitch !== null) {
        event.preventDefault();
        press(pitch, 0.8);
      }
    };
    const onUp = (event: KeyboardEvent) => {
      const pitch = pitchForCode(event.code, octaveRef.current);
      if (pitch !== null) {
        release(pitch);
      }
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, [active, press, release]);

  useEffect(() => {
    if (!active || !isWebMidiSupported()) {
      return;
    }
    let disconnect: (() => void) | null = null;
    connectMidiInputs((event) => {
      if (event.down) {
        press(event.pitch, event.velocity, event.at);
      } else {
        release(event.pitch);
      }
    })
      .then((cleanup) => {
        disconnect = cleanup;
        setStatus("midi");
      })
      .catch(() => setStatus("keyboard"));
    return () => disconnect?.();
  }, [active, press, release]);

  return {
    octave,
    setOctave: useCallback((next: number) => setOctave(clampOctave(next)), []),
    status,
    pressed: useCallback(() => pressedRef.current as ReadonlySet<number>, []),
    press,
    release,
  };
}
