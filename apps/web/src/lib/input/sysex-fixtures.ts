import type { SysexPattern } from "@/lib/input/sysex-pattern";
import type { MidiEvent } from "@/lib/input/web-midi";

/** Test devices from different makers, so SysEx handling is shown to hold for
 * each layout. */

/** A Genos2 slider: Yamaha parameter change with its position last. */
export const genosSlider: SysexPattern = [
  0x43,
  0x10,
  0x4c,
  0x10,
  0x00,
  0x0b,
  null,
];

/** A Roland data set: maker, device, model, command, a three byte address, the
 * position, then a checksum that moves against it. */
export function rolandDataSet(value: number): number[] {
  const address = [0x40, 0x00, 0x04];
  const sum = [...address, value].reduce((total, byte) => total + byte, 0);
  return [0x41, 0x10, 0x42, 0x12, ...address, value, (128 - (sum % 128)) % 128];
}

export const rolandSlider: SysexPattern = [
  0x41,
  0x10,
  0x42,
  0x12,
  0x40,
  0x00,
  0x04,
  null,
  null,
];

/** Each note event as its pitch and + for down or - for up. */
export function notesOf(events: readonly MidiEvent[]): string[] {
  return events.flatMap((event) =>
    event.type === "note" ? [`${event.pitch}${event.down ? "+" : "-"}`] : [],
  );
}

export function sysexBodiesOf(
  events: readonly MidiEvent[],
): (readonly number[])[] {
  return events.flatMap((event) =>
    event.type === "sysex" ? [event.body] : [],
  );
}
