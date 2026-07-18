export type MidiKeyEvent = {
  readonly pitch: number;
  readonly velocity: number;
  readonly down: boolean;
  /** When the device sent it, not when JavaScript got round to it. */
  readonly at: number;
};

const noteOn = 0x90;
const noteOff = 0x80;

export function isWebMidiSupported(): boolean {
  return typeof navigator !== "undefined" && "requestMIDIAccess" in navigator;
}

function decode(data: Uint8Array, at: number): MidiKeyEvent | null {
  const status = data[0];
  const pitch = data[1];
  const velocity = data[2];
  if (status === undefined || pitch === undefined || velocity === undefined) {
    return null;
  }
  const command = status & 0xf0;
  if (command === noteOn) {
    // A note on with zero velocity is how most keyboards send a note off.
    return { pitch, velocity: velocity / 127, down: velocity > 0, at };
  }
  if (command === noteOff) {
    return { pitch, velocity: velocity / 127, down: false, at };
  }
  return null;
}

export async function connectMidiInputs(
  onKey: (event: MidiKeyEvent) => void,
): Promise<() => void> {
  if (!isWebMidiSupported()) {
    throw new Error("This browser has no Web MIDI support");
  }
  const access = await navigator.requestMIDIAccess();

  const handleMessage = (event: MIDIMessageEvent) => {
    if (event.data === null) {
      return;
    }
    const decoded = decode(event.data, event.timeStamp);
    if (decoded !== null) {
      onKey(decoded);
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
