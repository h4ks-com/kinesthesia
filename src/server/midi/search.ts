import { defaultMelodyRate } from "@/lib/midi/melody";
import {
  buildPlayerUrl,
  defaultSpeed,
  type PlayerMode,
} from "@/lib/player-url";
import { config } from "@/server/config";
import { findSource, midiSources } from "@/server/midi/registry";
import type { MidiSearchItem, MidiSourceId } from "@/server/midi/types";

export type SearchMidiParams = {
  readonly query: string;
  readonly source: MidiSourceId | null;
  readonly limit: number;
};

export async function searchMidi({
  query,
  source,
  limit,
}: SearchMidiParams): Promise<MidiSearchItem[]> {
  const targets = source === null ? midiSources : [findSource(source)];
  const found = await Promise.all(
    targets
      .filter((entry) => entry !== null)
      .map((entry) => entry.search(query, limit)),
  );

  return found
    .flat()
    .sort((left, right) => right.plays - left.plays)
    .slice(0, limit)
    .map((result) => {
      const link = (mode: PlayerMode) =>
        buildPlayerUrl(config.appBaseUrl, mode, {
          url: result.downloadUrl,
          name: result.name,
          source: result.source,
          tracks: null,
          speed: defaultSpeed,
          simplified: false,
          melodyRate: defaultMelodyRate,
        });
      return {
        ...result,
        playUrl: link("watch"),
        learnUrl: link("learn"),
        battleUrl: link("battle"),
      };
    });
}
