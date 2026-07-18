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

function fromInteractiveElement(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest("button, a, input, select, textarea") !== null
  );
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
        // Space belongs to whatever control has focus before it means play.
        if (fromInteractiveElement(event.target)) {
          return;
        }
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
