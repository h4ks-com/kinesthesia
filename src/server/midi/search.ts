import { fileEndpointOn, searchItem } from "@/lib/midi/listing";
import { interleave, ranked } from "@/lib/midi/relevance";
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
  /** Sources the caller reaches for itself. Ours answers without them rather
   * than holding every other source behind an attempt that is not needed. */
  readonly skip?: readonly MidiSourceId[];
};

export function fileEndpoint(source: MidiSourceId, id: string): string {
  return fileEndpointOn(config.appBaseUrl, source, id);
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
  skip = [],
}: SearchMidiParams): Promise<MidiListing[]> {
  const targets = source === null ? midiSources : [findSource(source)];
  return Promise.all(
    targets
      .filter((entry) => entry !== null)
      .filter((entry) => !skip.includes(entry.id))
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
  const key = `${params.source ?? "*"}:${[...(params.skip ?? [])].sort().join("+")}:${params.limit}:${params.query.trim().toLowerCase()}`;
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
  return found.map((result) => searchItem(result, config.appBaseUrl));
}
