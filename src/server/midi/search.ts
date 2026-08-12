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
import { ranked } from "@/server/midi/relevance";
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

/** Searches already asked for, so a player typing a title walks back over their
 * own letters, a second player looking for the same song, and a retry after a
 * blank result all answer from here rather than from the source. Sources are
 * small hobby sites that fall over under a burst, so the cheapest thing we can
 * do for them is ask less. */
const answered = new Map<string, { at: number; results: MidiListing[] }>();
const rememberFor = 5 * 60 * 1000;
const remembered = 300;

function ask({
  query,
  source,
  limit,
}: SearchMidiParams): Promise<MidiListing[]> {
  const targets = source === null ? midiSources : [findSource(source)];
  return Promise.all(
    targets
      .filter((entry) => entry !== null)
      .map((entry) =>
        entry.search(query, limit).catch((): MidiListing[] => []),
      ),
  ).then((found) =>
    interleave(
      found.map((list) => ranked(list, query)),
      limit,
    ),
  );
}

async function listingsFor(params: SearchMidiParams): Promise<MidiListing[]> {
  const key = `${params.source ?? "*"}:${params.limit}:${params.query.trim().toLowerCase()}`;
  const now = Date.now();
  const known = answered.get(key);
  if (known !== undefined && now - known.at < rememberFor) {
    return known.results;
  }
  const results = await ask(params);
  // A source that is down answers empty, and holding that for five minutes
  // would keep the search blank long after it came back.
  if (results.length > 0) {
    if (answered.size >= remembered) {
      answered.clear();
    }
    answered.set(key, { at: now, results });
  }
  return results;
}

export async function searchMidi(
  params: SearchMidiParams,
): Promise<MidiSearchItem[]> {
  const found = await listingsFor(params);

  return found.map((result) => {
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
        skin: null,
        rise: false,
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
