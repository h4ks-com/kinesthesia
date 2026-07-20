import { bitmidiSource } from "@/server/midi/bitmidi";
import { mutopiaSource } from "@/server/midi/mutopia";
import type { MidiSource, MidiSourceId } from "@/server/midi/types";

export const midiSources: readonly MidiSource[] = [
  bitmidiSource,
  mutopiaSource,
];

export const midiSourceIds = midiSources.map((source) => source.id) as [
  MidiSourceId,
  ...MidiSourceId[],
];

export function findSource(id: string): MidiSource | null {
  return midiSources.find((source) => source.id === id) ?? null;
}
