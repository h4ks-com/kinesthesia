import { sourceFetch } from "@/server/http/fetch";
import type { MidiListing, MidiSource } from "@/server/midi/types";

const siteBase = "https://www.mutopiaproject.org";
const ftpPrefix = `${siteBase}/ftp/`;

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .trim();
}

function firstCell(block: string): string {
  const match = block.match(/<td[^>]*>([^<]+)<\/td>/i);
  return match ? decodeEntities(match[1] ?? "") : "";
}

function composer(block: string): string {
  const match = block.match(/by\s+([^<(]+)/i);
  return match ? decodeEntities(match[1] ?? "") : "";
}

/** The .mid link is absolute, so the id is the path under /ftp/ without the
 * extension; fileUrl puts it back together. */
function midId(block: string): string | null {
  const match = block.match(
    /href="https:\/\/www\.mutopiaproject\.org\/ftp\/([^"]+)\.mid"/i,
  );
  return match ? (match[1] ?? null) : null;
}

export const mutopiaSource: MidiSource = {
  id: "mutopia",
  label: "Mutopia",
  blurb:
    "Classical scores engraved by volunteers, free as public domain or Creative Commons. Search a composer or a piece; it has no pop or game music.",
  homeUrl: siteBase,
  license:
    "Public domain or Creative Commons; free to download, perform and redistribute.",

  fileUrl(id) {
    return `${ftpPrefix}${id}.mid`;
  },

  async search(query, limit) {
    const url = `${siteBase}/cgibin/make-table.cgi?searchingfor=${encodeURIComponent(query)}`;
    const response = await sourceFetch(url);
    if (!response.ok) {
      throw new Error(`Mutopia search failed with status ${response.status}`);
    }
    const html = await response.text();
    const blocks = html.split(/class="table-bordered result-table"/i).slice(1);

    const listings: MidiListing[] = [];
    const seen = new Set<string>();
    for (const block of blocks) {
      const id = midId(block);
      if (id === null || seen.has(id)) {
        continue;
      }
      seen.add(id);
      const title = firstCell(block);
      const by = composer(block);
      const name = by === "" ? title : `${title} — ${by}`;
      listings.push({
        id,
        source: "mutopia",
        name: name === "" ? id : name,
        plays: 0,
        sourceUrl: `${ftpPrefix}${id}.mid`,
      });
      if (listings.length >= limit) {
        break;
      }
    }
    return listings;
  },
};
