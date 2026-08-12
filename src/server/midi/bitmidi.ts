import { z } from "zod";
import { sourceFetch } from "@/server/http/fetch";
import { carriesEvery, words } from "@/server/midi/relevance";
import type { MidiListing, MidiSource } from "@/server/midi/types";

const siteBase = "https://bitmidi.com";
const searchEndpoint = `${siteBase}/api/midi/search`;
// Cloudflare answers the default fetch User-Agent with a 520; a browser one is served.
const browserUserAgent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36";
/** The largest page they serve, asked for over the default fifteen because
 * their ranking puts a two word match near the end: "maria mag" answers with
 * the one file carrying both words fiftieth. */
const pageSize = 50;

const bitmidiEntrySchema = z.object({
  id: z.number(),
  name: z.string(),
  plays: z.number().default(0),
  downloadUrl: z.string(),
  url: z.string().default(""),
});

const bitmidiReplySchema = z.object({
  result: z.object({
    results: z.array(bitmidiEntrySchema).default([]),
  }),
});

function toAbsolute(path: string): string {
  return path.startsWith("http") ? path : `${siteBase}${path}`;
}

export const bitmidiSource: MidiSource = {
  id: "bitmidi",
  label: "BitMidi",
  blurb:
    "A large open catalogue of user submitted MIDI files, mostly popular songs and games.",
  homeUrl: siteBase,
  license: "User submitted; check each song's own rights before reuse.",

  fileUrl(id) {
    return `${siteBase}/uploads/${id}.mid`;
  },

  async search(query) {
    const first = await page(query, 0);
    const wanted = words(query);
    // A full match can sit past the first page, since what carries every word
    // is ranked no higher than what carries one. Only asked for when the first
    // page holds none and there is a second: this is a hobby site that falls
    // over under a burst, so a keystroke costs it one request wherever it can.
    if (
      wanted.length < 2 ||
      first.length < pageSize ||
      first.some((entry) => carriesEvery(entry.name, wanted))
    ) {
      return first;
    }
    return [...first, ...(await page(query, 1))];
  },
};

async function page(query: string, index: number): Promise<MidiListing[]> {
  const url = `${searchEndpoint}?q=${encodeURIComponent(query)}&pageSize=${pageSize}&page=${index}`;
  const response = await sourceFetch(url, {
    headers: { "User-Agent": browserUserAgent },
  });
  if (!response.ok) {
    throw new Error(`BitMidi search failed with status ${response.status}`);
  }
  const reply = bitmidiReplySchema.parse(await response.json());
  return reply.result.results
    .filter((entry) => entry.downloadUrl !== "")
    .map((entry) => ({
      id: String(entry.id),
      source: "bitmidi" as const,
      name: entry.name,
      plays: entry.plays,
      sourceUrl: toAbsolute(entry.url),
    }));
}
