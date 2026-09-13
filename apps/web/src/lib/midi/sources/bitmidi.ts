import { carriesEvery, words } from "@/lib/midi/relevance";
import type { MidiListing } from "@/server/midi/types";

export const bitmidiBase = "https://bitmidi.com";
const searchEndpoint = `${bitmidiBase}/api/midi/search`;
/** The largest page they serve, asked for over the default fifteen because
 * their ranking puts a two word match near the end: "maria mag" answers with
 * the one file carrying both words fiftieth. */
const pageSize = 50;

/** How the catalogue is reached, whoever is asking. Their Cloudflare answers a
 * datacentre address with a challenge and a home one with the file, so this
 * runs from the browser as well as from our server and takes the transport it
 * is given rather than choosing one. */
export type SourceFetch = (url: string) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Read by hand rather than through a schema: this is the one parser that also
 * runs in the browser, and a validator costs a reader more to download than the
 * whole page it is on. Anything malformed is dropped rather than thrown, since
 * one odd row should not lose the catalogue. */
function readEntry(value: unknown): MidiListing[] {
  if (!isRecord(value)) {
    return [];
  }
  const { id, name, plays, downloadUrl, url } = value;
  if (
    typeof id !== "number" ||
    typeof name !== "string" ||
    typeof downloadUrl !== "string" ||
    downloadUrl === ""
  ) {
    return [];
  }
  return [
    {
      id: String(id),
      source: "bitmidi",
      name,
      plays: typeof plays === "number" ? plays : 0,
      sourceUrl: toAbsolute(typeof url === "string" ? url : ""),
    },
  ];
}

function readPage(payload: unknown): MidiListing[] {
  const result = isRecord(payload) ? payload.result : null;
  const rows = isRecord(result) ? result.results : null;
  return Array.isArray(rows) ? rows.flatMap(readEntry) : [];
}

function toAbsolute(path: string): string {
  return path.startsWith("http") ? path : `${bitmidiBase}${path}`;
}

export function bitmidiFileUrl(id: string): string {
  return `${bitmidiBase}/uploads/${id}.mid`;
}

export async function searchBitmidi(
  query: string,
  fetcher: SourceFetch,
): Promise<MidiListing[]> {
  const first = await page(query, 0, fetcher);
  const wanted = words(query);
  // A full match can sit past the first page, since what carries every word is
  // ranked no higher than what carries one. Only asked for when the first page
  // holds none and there is a second: this is a hobby site that falls over
  // under a burst, so a keystroke costs it one request wherever it can.
  if (
    wanted.length < 2 ||
    first.length < pageSize ||
    first.some((entry) => carriesEvery(entry.name, wanted))
  ) {
    return first;
  }
  return [...first, ...(await page(query, 1, fetcher))];
}

async function page(
  query: string,
  index: number,
  fetcher: SourceFetch,
): Promise<MidiListing[]> {
  const url = `${searchEndpoint}?q=${encodeURIComponent(query)}&pageSize=${pageSize}&page=${index}`;
  const response = await fetcher(url);
  if (!response.ok) {
    throw new Error(`BitMidi search failed with status ${response.status}`);
  }
  return readPage(await response.json());
}
