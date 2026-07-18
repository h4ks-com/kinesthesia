import { bitmidiSource } from "@/server/midi/bitmidi";
import type { MidiSource, MidiSourceId } from "@/server/midi/types";

export const midiSources: readonly MidiSource[] = [bitmidiSource];

export const midiSourceIds = midiSources.map((source) => source.id) as [
  MidiSourceId,
  ...MidiSourceId[],
];

export function findSource(id: MidiSourceId): MidiSource | null {
  return midiSources.find((source) => source.id === id) ?? null;
}
