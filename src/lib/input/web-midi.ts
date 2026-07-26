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

export type MidiEvent =
  | MidiNoteEvent
  | MidiProgramEvent
  | MidiSustainEvent
  | MidiBendEvent
  | MidiModulationEvent;

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
    if (value === undefined) {
      return null;
    }
    if (controller === sustainController) {
      return { type: "sustain", channel, down: value >= 64 };
    }
    if (controller === modulationController) {
      return { type: "modulation", channel, depth: value / 127 };
    }
    return null;
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
  const access = await navigator.requestMIDIAccess();

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
