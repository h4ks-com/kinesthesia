import { defaultMelodyRate } from "@/lib/midi/melody";
import { defaultTranspose } from "@/lib/midi/song";
import {
  buildPlayerUrl,
  defaultSpeed,
  defaultStart,
  type PlayerMode,
} from "@/lib/player-url";
import { config } from "@/server/config";
import { findSource, midiSources } from "@/server/midi/registry";
import type {
  MidiListing,
  MidiSearchItem,
  MidiSourceId,
} from "@/server/midi/types";

export type SearchMidiParams = {
  readonly query: string;
  readonly source: MidiSourceId | null;
  readonly limit: number;
};

/** Every file, whatever its source, is fetched through this one endpoint, so a
 * source without cross origin headers still plays and the client never has to
 * know where the bytes actually live. */
export function fileEndpoint(source: MidiSourceId, id: string): string {
  const target = new URL("/api/midi/file", config.appBaseUrl);
  target.searchParams.set("source", source);
  target.searchParams.set("id", id);
  return target.toString();
}

/** Takes one from each source in turn, so a source that does not count plays is
 * not buried under one that does. */
function interleave(
  lists: readonly MidiListing[][],
  limit: number,
): MidiListing[] {
  const merged: MidiListing[] = [];
  const depth = Math.max(0, ...lists.map((list) => list.length));
  for (let row = 0; row < depth && merged.length < limit; row += 1) {
    for (const list of lists) {
      const entry = list[row];
      if (entry !== undefined) {
        merged.push(entry);
        if (merged.length >= limit) {
          break;
        }
      }
    }
  }
  return merged;
}

export async function searchMidi({
  query,
  source,
  limit,
}: SearchMidiParams): Promise<MidiSearchItem[]> {
  const targets = source === null ? midiSources : [findSource(source)];
  const found = await Promise.all(
    targets
      .filter((entry) => entry !== null)
      .map((entry) =>
        entry.search(query, limit).catch((): MidiListing[] => []),
      ),
  );

  return interleave(found, limit).map((result) => {
    const downloadUrl = fileEndpoint(result.source, result.id);
    const link = (mode: PlayerMode) =>
      buildPlayerUrl(config.appBaseUrl, mode, {
        url: downloadUrl,
        name: result.name,
        source: result.source,
        tracks: null,
        speed: defaultSpeed,
        simplified: false,
        melodyRate: defaultMelodyRate,
        transpose: defaultTranspose,
        focus: false,
        start: defaultStart,
      });
    return {
      ...result,
      downloadUrl,
      playUrl: link("watch"),
      learnUrl: link("learn"),
      multiplayerUrl: link("multiplayer"),
    };
  });
}
