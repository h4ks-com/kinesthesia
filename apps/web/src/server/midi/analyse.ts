import type { Digest } from "@/lib/midi/analysis";
import { parseSong } from "@/lib/midi/song";
import { sourceFetch } from "@/server/http/fetch";

/** Reads a .mid with the same parser the player runs, so what this reports is
 * what the player will show. The same report the song info panel reads
 * straight off the parsed song. */
export async function analyseMidi(url: string, name: string): Promise<Digest> {
  const response = await sourceFetch(url);
  if (!response.ok) {
    throw new Error(`Could not download that MIDI (status ${response.status})`);
  }
  return parseSong(await response.arrayBuffer(), name).report;
}
