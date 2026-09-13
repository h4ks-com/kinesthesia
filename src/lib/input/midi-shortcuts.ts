"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  learnPattern,
  matchesPattern,
  patternsOverlap,
  patternValue,
  type SysexListening,
  type SysexPattern,
  samePattern,
} from "@/lib/input/sysex-pattern";
import type { ControlInput } from "@/lib/input/web-midi";
import { type BackgroundChoice, readStoredChoice } from "@/lib/skins/backdrop";
import {
  loadGlobalSettings,
  updateGlobalSettings,
} from "@/lib/storage/settings";

/** The control a background is bound to: a channel controller, or the shape of
 * the SysEx messages a control sends. */
export type ControlRef =
  | {
      readonly kind: "cc";
      readonly channel: number;
      readonly controller: number;
    }
  | { readonly kind: "sysex"; readonly pattern: SysexPattern };

/** One button switches to a single background; one slider spreads its travel
 * across every background the mode offers, so a single control reaches them
 * all. */
export type MidiShortcut =
  | {
      readonly kind: "button";
      readonly control: ControlRef;
      readonly target: BackgroundChoice | null;
    }
  | { readonly kind: "slider"; readonly control: ControlRef };

/** Controllers the player already reads (modulation, sustain), so neither a
 * button nor a slider may take them. */
export const reservedControllers: ReadonlySet<number> = new Set([1, 64]);

/** A bound button fires once on the press, so this is the value a press crosses
 * and a release drops below. */
const triggerThreshold = 64;

/** Two bindings aim at the same background when their choices match, so binding
 * a second button to one lets go of the first. */
export function sameTarget(
  a: BackgroundChoice | null,
  b: BackgroundChoice | null,
): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  if (a.kind !== b.kind) {
    return false;
  }
  if (a.kind === "built-in" && b.kind === "built-in") {
    return a.id === b.id;
  }
  if (a.kind === "script" && b.kind === "script") {
    return a.id === b.id;
  }
  if (a.kind === "image" && b.kind === "image") {
    return a.image.source === b.image.source;
  }
  return false;
}

export function sameControl(a: ControlRef, b: ControlRef): boolean {
  if (a.kind !== b.kind) {
    return false;
  }
  if (a.kind === "cc" && b.kind === "cc") {
    return a.channel === b.channel && a.controller === b.controller;
  }
  if (a.kind === "sysex" && b.kind === "sysex") {
    return samePattern(a.pattern, b.pattern);
  }
  return false;
}

/** Whether one incoming message could reach both controls. */
function controlsOverlap(a: ControlRef, b: ControlRef): boolean {
  return a.kind === "sysex" && b.kind === "sysex"
    ? patternsOverlap(a.pattern, b.pattern)
    : sameControl(a, b);
}

function controlMatches(ref: ControlRef, input: ControlInput): boolean {
  if (ref.kind === "cc" && input.kind === "cc") {
    return ref.channel === input.channel && ref.controller === input.controller;
  }
  return (
    ref.kind === "sysex" &&
    input.kind === "sysex" &&
    matchesPattern(input.body, ref.pattern)
  );
}

/** The position a matched control reports, or null for a SysEx button that
 * sends one fixed message. */
function controlValue(ref: ControlRef, input: ControlInput): number | null {
  if (input.kind === "cc") {
    return input.value;
  }
  return ref.kind === "sysex" ? patternValue(input.body, ref.pattern) : null;
}

/** The control being bound, once the input shows enough of it. A button binds
 * the message it sent. A SysEx slider shows which bytes carry its position only
 * once it moves, so it is read against the message before. */
function learnedControl(
  input: ControlInput,
  learning: ActiveLearning,
  previous: readonly number[] | null,
): ControlRef | null {
  if (input.kind === "cc") {
    return { kind: "cc", channel: input.channel, controller: input.controller };
  }
  if (learning.kind === "button") {
    return { kind: "sysex", pattern: input.body };
  }
  const pattern =
    previous === null ? null : learnPattern([previous, input.body]);
  return pattern === null ? null : { kind: "sysex", pattern };
}

function controlId(ref: ControlRef): string {
  return ref.kind === "cc"
    ? `cc:${ref.channel}:${ref.controller}`
    : `sysex:${ref.pattern.map((byte) => byte ?? "*").join(":")}`;
}

export function bindingFor(
  shortcuts: readonly MidiShortcut[],
  target: BackgroundChoice | null,
): MidiShortcut | null {
  return (
    shortcuts.find(
      (entry) => entry.kind === "button" && sameTarget(entry.target, target),
    ) ?? null
  );
}

export function sliderBinding(
  shortcuts: readonly MidiShortcut[],
): MidiShortcut | null {
  return shortcuts.find((entry) => entry.kind === "slider") ?? null;
}

export type ShortcutConflict = "reserved" | "taken";

type Learning =
  | { readonly kind: "button"; readonly target: BackgroundChoice | null }
  | { readonly kind: "slider" }
  | null;

type ActiveLearning = Exclude<Learning, null>;

/** Why a control may not be bound: it is one the player reads, or another
 * binding already owns it. Re-grabbing the same one (a button rebinding its own
 * background, or the slider being reassigned) is allowed. */
function controlConflict(
  control: ControlRef,
  shortcuts: readonly MidiShortcut[],
  learning: ActiveLearning,
): ShortcutConflict | null {
  if (control.kind === "cc" && reservedControllers.has(control.controller)) {
    return "reserved";
  }
  for (const entry of shortcuts) {
    if (!controlsOverlap(entry.control, control)) {
      continue;
    }
    if (
      learning.kind === "button" &&
      entry.kind === "button" &&
      sameTarget(entry.target, learning.target)
    ) {
      continue;
    }
    if (learning.kind === "slider" && entry.kind === "slider") {
      continue;
    }
    return "taken";
  }
  return null;
}

function normalizeControl(value: unknown): ControlRef | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const v = value as {
    kind?: unknown;
    channel?: unknown;
    controller?: unknown;
    pattern?: unknown;
    key?: unknown;
  };
  if (
    v.kind === "cc" &&
    typeof v.channel === "number" &&
    typeof v.controller === "number"
  ) {
    return { kind: "cc", channel: v.channel, controller: v.controller };
  }
  if (v.kind !== "sysex") {
    return null;
  }
  if (
    Array.isArray(v.pattern) &&
    v.pattern.length > 0 &&
    v.pattern.every((byte) => typeof byte === "number" || byte === null)
  ) {
    return { kind: "sysex", pattern: v.pattern as SysexPattern };
  }
  // Bindings saved before patterns hold a Yamaha parameter change's six byte
  // address, whose position is the byte after it.
  if (
    Array.isArray(v.key) &&
    v.key.length > 0 &&
    v.key.every((byte) => typeof byte === "number")
  ) {
    return { kind: "sysex", pattern: [...(v.key as number[]), null] };
  }
  return null;
}

/** Settings are read as raw rows; this carries the ones that still parse and
 * migrates a button saved before controls carried their kind. */
function normalize(raw: unknown): MidiShortcut[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.flatMap((entry): MidiShortcut[] => {
    if (typeof entry !== "object" || entry === null) {
      return [];
    }
    const e = entry as Record<string, unknown>;
    const control = normalizeControl(e.control);
    if (typeof e.kind === "string" && control !== null) {
      if (e.kind === "button") {
        return buttonFor(control, e.target);
      }
      if (e.kind === "slider") {
        return [{ kind: "slider", control }];
      }
    }
    if (typeof e.channel === "number" && typeof e.controller === "number") {
      return buttonFor(
        { kind: "cc", channel: e.channel, controller: e.controller },
        e.target,
      );
    }
    return [];
  });
}

/** A saved button, or nothing where its background cannot be read. Absent is
 * plain, which is a target like any other. A button left bound to something
 * unreadable would fire and land somewhere else, so it goes instead. */
function buttonFor(control: ControlRef, raw: unknown): MidiShortcut[] {
  if (raw === undefined || raw === null) {
    return [{ kind: "button", control, target: null }];
  }
  const target = readStoredChoice(raw);
  return target === null ? [] : [{ kind: "button", control, target }];
}

export type MidiShortcuts = {
  readonly bindings: readonly MidiShortcut[];
  readonly learning: Learning;
  readonly conflict: ShortcutConflict | null;
  onControl: (control: ControlInput) => void;
  sysexListening: () => SysexListening;
  beginLearnButton: (target: BackgroundChoice | null) => void;
  beginLearnSlider: () => void;
  cancelLearn: () => void;
  clearButton: (control: ControlRef) => void;
  clearSlider: () => void;
};

/** One place where a controller reaches a background. A button fires its one
 * background on a press; a slider picks across every background the mode offers
 * by the position of its travel. */
export function useMidiShortcuts(options: {
  onTrigger: (target: BackgroundChoice | null) => void;
  /** The ordered backgrounds a slider spreads itself across, ending in plain so
   * a full throw clears the roll. Read fresh each call so it tracks the mode. */
  targets: () => readonly (BackgroundChoice | null)[];
}): MidiShortcuts {
  const { onTrigger, targets } = options;
  const [bindings, setBindings] = useState<readonly MidiShortcut[]>([]);
  const [learning, setLearning] = useState<Learning>(null);
  const [conflict, setConflict] = useState<ShortcutConflict | null>(null);

  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;
  const learningRef = useRef(learning);
  learningRef.current = learning;
  const onTriggerRef = useRef(onTrigger);
  onTriggerRef.current = onTrigger;
  const targetsRef = useRef(targets);
  targetsRef.current = targets;
  // A held button reports its value more than once; only the rising edge fires,
  // so a press switches once however long it is held.
  const held = useRef(new Set<string>());
  const previousSysex = useRef<readonly number[] | null>(null);

  useEffect(() => {
    void loadGlobalSettings().then((stored) => {
      if (stored?.midiShortcuts !== undefined) {
        setBindings(normalize(stored.midiShortcuts));
      }
    });
  }, []);

  const persist = useCallback((next: readonly MidiShortcut[]) => {
    setBindings(next);
    bindingsRef.current = next;
    void updateGlobalSettings({ midiShortcuts: next });
  }, []);

  const onControl = useCallback(
    (control: ControlInput) => {
      const learningNow = learningRef.current;
      const all = bindingsRef.current;

      if (learningNow !== null) {
        const ref = learnedControl(control, learningNow, previousSysex.current);
        if (control.kind === "sysex") {
          previousSysex.current = control.body;
        }
        if (ref === null) {
          return;
        }
        const found = controlConflict(ref, all, learningNow);
        if (found !== null) {
          setConflict(found);
          return;
        }
        const next =
          learningNow.kind === "button"
            ? [
                ...all.filter(
                  (entry) =>
                    !(
                      entry.kind === "button" &&
                      sameTarget(entry.target, learningNow.target)
                    ),
                ),
                {
                  kind: "button",
                  control: ref,
                  target: learningNow.target,
                } as MidiShortcut,
              ]
            : [
                ...all.filter((entry) => entry.kind !== "slider"),
                { kind: "slider", control: ref } as MidiShortcut,
              ];
        setConflict(null);
        setLearning(null);
        // The rest of a sweep arrives before the next render, and must not bind
        // again or be read as the control it just became.
        learningRef.current = null;
        previousSysex.current = null;
        persist(next);
        return;
      }

      const buttonHit = all.find(
        (entry) =>
          entry.kind === "button" && controlMatches(entry.control, control),
      );
      if (buttonHit !== undefined && buttonHit.kind === "button") {
        const value = controlValue(buttonHit.control, control);
        if (value === null) {
          onTriggerRef.current(buttonHit.target);
          return;
        }
        const id = controlId(buttonHit.control);
        const down = value >= triggerThreshold;
        const wasDown = held.current.has(id);
        if (down) {
          held.current.add(id);
        } else {
          held.current.delete(id);
        }
        if (down && !wasDown) {
          onTriggerRef.current(buttonHit.target);
        }
        return;
      }

      const slider = all.find(
        (entry) =>
          entry.kind === "slider" && controlMatches(entry.control, control),
      );
      const value =
        slider === undefined ? null : controlValue(slider.control, control);
      if (value !== null) {
        const list = targetsRef.current();
        if (list.length === 0) {
          return;
        }
        const width = 128 / list.length;
        const index = Math.min(list.length - 1, Math.floor(value / width));
        onTriggerRef.current(list[index] ?? null);
      }
    },
    [persist],
  );

  const beginLearnButton = useCallback((target: BackgroundChoice | null) => {
    setConflict(null);
    previousSysex.current = null;
    setLearning({ kind: "button", target });
  }, []);

  const beginLearnSlider = useCallback(() => {
    setConflict(null);
    previousSysex.current = null;
    setLearning({ kind: "slider" });
  }, []);

  const cancelLearn = useCallback(() => {
    setConflict(null);
    setLearning(null);
  }, []);

  const clearButton = useCallback(
    (control: ControlRef) => {
      persist(
        bindingsRef.current.filter(
          (entry) => !sameControl(entry.control, control),
        ),
      );
    },
    [persist],
  );

  const clearSlider = useCallback(() => {
    persist(bindingsRef.current.filter((entry) => entry.kind !== "slider"));
  }, [persist]);

  const sysexListening = useCallback(
    (): SysexListening => ({
      patterns: bindingsRef.current.flatMap((entry) =>
        entry.control.kind === "sysex" ? [entry.control.pattern] : [],
      ),
      learning: learningRef.current !== null,
    }),
    [],
  );

  return {
    bindings,
    learning,
    conflict,
    onControl,
    sysexListening,
    beginLearnButton,
    beginLearnSlider,
    cancelLearn,
    clearButton,
    clearSlider,
  };
}
