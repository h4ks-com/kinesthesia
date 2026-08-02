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

/** A Yamaha parameter-change SysEx, the form a Genos2 slider emits. The address
 * is the slider's identity and the last data byte its position, 0 to 127. */
export type MidiSysexEvent = {
  readonly type: "sysex";
  readonly key: readonly number[];
  readonly value: number;
};

/** A control the player can bind a background to: a channel controller or a
 * Yamaha SysEx address. The value is the position a slider reports or the press
 * a button reports. */
export type ControlInput =
  | {
      readonly kind: "cc";
      readonly channel: number;
      readonly controller: number;
      readonly value: number;
    }
  | {
      readonly kind: "sysex";
      readonly key: readonly number[];
      readonly value: number;
    };

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
const bendCentre = 8192;

export function isWebMidiSupported(): boolean {
  return typeof navigator !== "undefined" && "requestMIDIAccess" in navigator;
}

export function decodeMidi(data: Uint8Array, at: number): MidiEvent | null {
  const status = data[0];
  if (status === undefined) {
    return null;
  }

  if (status === 0xf0) {
    // Yamaha parameter-change: F0 43 1n <model> <a1> <a2> <a3> <value> F7.
    // A Genos2 slider sweeps <value> 0-127 at a fixed address; the address is
    // its identity. Anything else (other makers, other layouts) is ignored.
    const manufacturer = data[1];
    const sub = data[2];
    const end = data[8];
    if (
      data.length !== 9 ||
      manufacturer !== 0x43 ||
      sub === undefined ||
      (sub & 0xf0) !== 0x10 ||
      end !== 0xf7
    ) {
      return null;
    }
    const model = data[3];
    const a1 = data[4];
    const a2 = data[5];
    const a3 = data[6];
    const value = data[7];
    if (
      model === undefined ||
      a1 === undefined ||
      a2 === undefined ||
      a3 === undefined ||
      value === undefined
    ) {
      return null;
    }
    return {
      type: "sysex",
      key: [manufacturer, sub, model, a1, a2, a3],
      value,
    };
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

export async function connectMidiInputs(
  onEvent: (event: MidiEvent) => void,
): Promise<() => void> {
  if (!isWebMidiSupported()) {
    throw new Error("This browser has no Web MIDI support");
  }
  // SysEx is asked for so a Yamaha slider's parameter-change reaches the page;
  // a visitor who refuses the stronger prompt still gets notes and CC, since the
  // slider alone needs SysEx and the rest does not.
  const access = await navigator
    .requestMIDIAccess({ sysex: true })
    .catch(() => navigator.requestMIDIAccess());

  const handleMessage = (event: MIDIMessageEvent) => {
    if (event.data === null) {
      return;
    }
    const decoded = decodeMidi(event.data, event.timeStamp);
    if (decoded !== null) {
      onEvent(decoded);
    }
  };

  const bind = () => {
    for (const input of access.inputs.values()) {
      input.onmidimessage = handleMessage;
    }
  };

  bind();
  access.onstatechange = bind;

  return () => {
    access.onstatechange = null;
    for (const input of access.inputs.values()) {
      input.onmidimessage = null;
    }
  };
}
