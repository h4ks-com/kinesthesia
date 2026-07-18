import { z } from "zod";
import { sourceFetch } from "@/server/http/fetch";
import type { MidiSearchResult, MidiSource } from "@/server/midi/types";

const siteBase = "https://bitmidi.com";
const searchEndpoint = `${siteBase}/api/midi/search`;
// Cloudflare answers the default fetch User-Agent with a 520; a browser one is served.
const browserUserAgent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36";

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

  async search(query, limit) {
    const url = `${searchEndpoint}?q=${encodeURIComponent(query)}`;
    const response = await sourceFetch(url, {
      headers: { "User-Agent": browserUserAgent },
    });
    if (!response.ok) {
      throw new Error(`BitMidi search failed with status ${response.status}`);
    }

    const reply = bitmidiReplySchema.parse(await response.json());
    const results: MidiSearchResult[] = reply.result.results
      .filter((entry) => entry.downloadUrl !== "")
      .map((entry) => ({
        id: String(entry.id),
        source: "bitmidi" as const,
        name: entry.name,
        plays: entry.plays,
        downloadUrl: toAbsolute(entry.downloadUrl),
        sourceUrl: toAbsolute(entry.url),
      }));

    return results.slice(0, limit);
  },
};
