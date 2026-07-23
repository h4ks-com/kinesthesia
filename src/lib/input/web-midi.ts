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

export type MidiEvent = MidiNoteEvent | MidiProgramEvent | MidiSustainEvent;

const noteOn = 0x90;
const noteOff = 0x80;
const controlChange = 0xb0;
const programChange = 0xc0;
const sustainController = 64;

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

  if (command === controlChange) {
    const controller = data[1];
    const value = data[2];
    if (controller !== sustainController || value === undefined) {
      return null;
    }
    return { type: "sustain", channel, down: value >= 64 };
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
