import { bitmidiSource } from "@/server/midi/bitmidi";
import { isSafeId } from "@/server/midi/id";
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

export function sourceFileUrl(source: string, id: string): string | null {
  const provider = findSource(source);
  return provider === null || !isSafeId(id) ? null : provider.fileUrl(id);
}
