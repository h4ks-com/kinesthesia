import {
  createSysexRecovery,
  type SysexRecovery,
  type TimedMessage,
} from "@/lib/input/chrome-split-sysex";
import type { SysexListening } from "@/lib/input/sysex-pattern";

/** A note struck or lifted on the device. */
export type MidiNoteEvent = {
  readonly type: "note";
  readonly pitch: number;
  readonly velocity: number;
  readonly down: boolean;
  /** Which of the device's 16 channels it came in on, so play mode can route a
   * split or multitimbral controller to a part each. */
  readonly channel: number;
  /** When the device sent it, not when JavaScript got round to it. */
  readonly at: number;
};

/** The device asking for an instrument on a channel, so play mode can voice a
 * channel the way the controller intends. */
export type MidiProgramEvent = {
  readonly type: "program";
  readonly channel: number;
  readonly program: number;
};

/** The sustain pedal going down or up (control 64). */
export type MidiSustainEvent = {
  readonly type: "sustain";
  readonly channel: number;
  readonly down: boolean;
};

/** The bend wheel, as a signed fraction of its travel. */
export type MidiBendEvent = {
  readonly type: "bend";
  readonly channel: number;
  readonly amount: number;
};

/** The modulation wheel (control 1), as a fraction of its travel. */
export type MidiModulationEvent = {
  readonly type: "modulation";
  readonly channel: number;
  readonly depth: number;
};

/** Any control change the player does not already read on its own, passed
 * through so a button the player bound to a background can reach it. */
export type MidiControlEvent = {
  readonly type: "control";
  readonly channel: number;
  readonly controller: number;
  readonly value: number;
};

/** A system exclusive message, as the bytes between its F0 and F7. What they
 * mean is up to the maker, so a binding learns its shape from the device. */
export type MidiSysexEvent = {
  readonly type: "sysex";
  readonly body: readonly number[];
};

/** A control the player can bind a background to: a channel controller with the
 * position or press it reports, or a SysEx message. */
export type ControlInput =
  | {
      readonly kind: "cc";
      readonly channel: number;
      readonly controller: number;
      readonly value: number;
    }
  | { readonly kind: "sysex"; readonly body: readonly number[] };

export type MidiEvent =
  | MidiNoteEvent
  | MidiProgramEvent
  | MidiSustainEvent
  | MidiBendEvent
  | MidiModulationEvent
  | MidiControlEvent
  | MidiSysexEvent;

const noteOn = 0x90;
const noteOff = 0x80;
const controlChange = 0xb0;
const programChange = 0xc0;
const pitchBend = 0xe0;
const sustainController = 64;
const modulationController = 1;
/** Bend arrives as two 7 bit halves around a centre of 8192, so a wheel at rest
 * reads zero and each direction reaches one. */
export const bendCentre = 8192;

export function isWebMidiSupported(): boolean {
  return typeof navigator !== "undefined" && "requestMIDIAccess" in navigator;
}

/** A channel as people and devices number it, counted from one. */
export function channelLabel(channel: number): string {
  return `ch${channel + 1}`;
}

export function hexBytes(bytes: readonly number[]): string {
  return bytes
    .map((byte) => byte.toString(16).padStart(2, "0").toUpperCase())
    .join(" ");
}

/** We ask for SysEx so a controller that speaks it can be bound; a visitor who
 * refuses the stronger prompt still gets notes and CC. */
export function requestMidiAccess(): Promise<MIDIAccess> {
  return navigator
    .requestMIDIAccess({ sysex: true })
    .catch(() => navigator.requestMIDIAccess());
}

export function decodeMidi(data: Uint8Array, at: number): MidiEvent | null {
  const status = data[0];
  if (status === undefined) {
    return null;
  }

  if (status === 0xf0) {
    return data.length > 2 && data[data.length - 1] === 0xf7
      ? { type: "sysex", body: Array.from(data.subarray(1, -1)) }
      : null;
  }
  const command = status & 0xf0;
  const channel = status & 0x0f;

  if (command === programChange) {
    const program = data[1];
    return program === undefined ? null : { type: "program", channel, program };
  }

  if (command === pitchBend) {
    const low = data[1];
    const high = data[2];
    if (low === undefined || high === undefined) {
      return null;
    }
    const raw = (high << 7) | low;
    return { type: "bend", channel, amount: (raw - bendCentre) / bendCentre };
  }

  if (command === controlChange) {
    const controller = data[1];
    const value = data[2];
    if (controller === undefined || value === undefined) {
      return null;
    }
    if (controller === sustainController) {
      return { type: "sustain", channel, down: value >= 64 };
    }
    if (controller === modulationController) {
      return { type: "modulation", channel, depth: value / 127 };
    }
    return { type: "control", channel, controller, value };
  }

  const pitch = data[1];
  const velocity = data[2];
  if (pitch === undefined || velocity === undefined) {
    return null;
  }
  if (command === noteOn) {
    // A note on with zero velocity is how most keyboards send a note off.
    return {
      type: "note",
      pitch,
      velocity: velocity / 127,
      down: velocity > 0,
      channel,
      at,
    };
  }
  if (command === noteOff) {
    return {
      type: "note",
      pitch,
      velocity: velocity / 127,
      down: false,
      channel,
      at,
    };
  }
  return null;
}

/** One per device port for the life of the page. The browser keeps a port's
 * leftover byte across a reconnect and whatever another port sends, so what is
 * known about that port has to outlast both. */
const recoveries = new Map<string, SysexRecovery>();

function recoveryFor(port: string): SysexRecovery {
  const existing = recoveries.get(port);
  if (existing !== undefined) {
    return existing;
  }
  const made = createSysexRecovery();
  recoveries.set(port, made);
  return made;
}

export async function connectMidiInputs(
  onEvent: (event: MidiEvent) => void,
  sysexListening: () => SysexListening,
): Promise<() => void> {
  if (!isWebMidiSupported()) {
    throw new Error("This browser has no Web MIDI support");
  }
  const access = await requestMidiAccess();

  const expiries = new Map<string, ReturnType<typeof setTimeout>>();

  const deliver = (messages: readonly TimedMessage[]): void => {
    for (const { message, at } of messages) {
      const decoded = decodeMidi(message, at);
      if (decoded !== null) {
        onEvent(decoded);
      }
    }
  };

  const scheduleExpiry = (port: string, recovery: SysexRecovery): void => {
    clearTimeout(expiries.get(port));
    expiries.delete(port);
    const due = recovery.due();
    if (due === null) {
      return;
    }
    expiries.set(
      port,
      setTimeout(
        () => {
          expiries.delete(port);
          deliver(recovery.expire(performance.now()));
          scheduleExpiry(port, recovery);
        },
        Math.max(0, due - performance.now()),
      ),
    );
  };

  const bind = () => {
    for (const input of access.inputs.values()) {
      const port = input.id;
      const recovery = recoveryFor(port);
      input.onmidimessage = (event: MIDIMessageEvent) => {
        if (event.data === null) {
          return;
        }
        deliver(
          recovery.push(
            event.data,
            event.timeStamp,
            performance.now(),
            sysexListening(),
          ),
        );
        scheduleExpiry(port, recovery);
      };
    }
  };

  bind();
  access.onstatechange = bind;

  return () => {
    // A held message belongs to a page that is gone, so we settle it here and
    // the next page to connect starts clean.
    for (const [port, expiry] of expiries) {
      clearTimeout(expiry);
      recoveryFor(port).expire(Number.POSITIVE_INFINITY);
    }
    access.onstatechange = null;
    for (const input of access.inputs.values()) {
      input.onmidimessage = null;
    }
  };
}
