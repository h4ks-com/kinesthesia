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

/** Null where the input names no channel, which is every source but a MIDI
 * device: the computer keyboard and touch play into the active part. */
export type InputChannel = number | null;

export type NoteInput = {
  octave: number;
  setOctave: (octave: number) => void;
  status: InputStatus;
  pressed: () => ReadonlySet<number>;
  press: (
    pitch: number,
    velocity: number,
    at?: number,
    channel?: number,
  ) => void;
  release: (pitch: number) => void;
};

type Options = {
  active: boolean;
  onPress: (
    pitch: number,
    velocity: number,
    at: number,
    channel: InputChannel,
  ) => void;
  onRelease?: (pitch: number, channel: InputChannel) => void;
  /** A MIDI device asking for an instrument on a channel. */
  onProgram?: (channel: number, program: number) => void;
  /** The MIDI sustain pedal, per channel. */
  onSustain?: (channel: number, down: boolean) => void;
  /** Absent in a mode with nothing to toggle, so space is left to activate the
   * focused control instead of being swallowed. */
  onToggle?: () => void;
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
  onProgram,
  onSustain,
  onToggle,
}: Options): NoteInput {
  const [octave, setOctave] = useState(defaultOctave);
  const [status, setStatus] = useState<InputStatus>("keyboard");
  const pressedRef = useRef<Set<number>>(new Set());
  // The pitch each held key opened, so its release ends that note even if the
  // octave shifted while it was down and its code now maps elsewhere.
  const keyPitch = useRef(new Map<string, number>());
  const octaveRef = useRef(octave);
  octaveRef.current = octave;
  const pressRef = useRef(onPress);
  pressRef.current = onPress;
  const toggleRef = useRef(onToggle);
  toggleRef.current = onToggle;
  const releaseRef = useRef(onRelease);
  releaseRef.current = onRelease;
  const programRef = useRef(onProgram);
  programRef.current = onProgram;
  const sustainRef = useRef(onSustain);
  sustainRef.current = onSustain;

  const press = useCallback(
    (pitch: number, velocity: number, at?: number, channel?: number) => {
      pressedRef.current.add(pitch);
      pressRef.current(
        pitch,
        velocity,
        at ?? performance.now(),
        channel ?? null,
      );
    },
    [],
  );

  const release = useCallback((pitch: number, channel?: number) => {
    pressedRef.current.delete(pitch);
    releaseRef.current?.(pitch, channel ?? null);
  }, []);

  useEffect(() => {
    const onDown = (event: KeyboardEvent) => {
      if (event.repeat) {
        return;
      }
      if (event.code === "Space") {
        const toggle = toggleRef.current;
        // Only claim space where there is something to toggle, so a mode
        // without a transport leaves it to activate the focused control.
        if (toggle === undefined || isTextEntry(event.target)) {
          return;
        }
        event.preventDefault();
        toggle();
        return;
      }
      if (!active) {
        return;
      }
      // Typing in a search or text field must not play notes or shift octave,
      // or fields like the instrument search are impossible to type into.
      if (isTextEntry(event.target)) {
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
        keyPitch.current.set(event.code, pitch);
        press(pitch, 0.8);
      }
    };
    const onUp = (event: KeyboardEvent) => {
      const pitch = keyPitch.current.get(event.code);
      if (pitch !== undefined) {
        keyPitch.current.delete(event.code);
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
      if (event.type === "program") {
        programRef.current?.(event.channel, event.program);
      } else if (event.type === "sustain") {
        sustainRef.current?.(event.channel, event.down);
      } else if (event.down) {
        press(event.pitch, event.velocity, event.at, event.channel);
      } else {
        release(event.pitch, event.channel);
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
