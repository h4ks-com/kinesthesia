import { defaultMelodyRate } from "@/lib/midi/melody";
import { defaultTranspose } from "@/lib/midi/song";
import {
  buildPlayerUrl,
  defaultSpeed,
  defaultStart,
  type PlayerMode,
} from "@/lib/player-url";
import type {
  MidiListing,
  MidiSearchItem,
  MidiSourceId,
} from "@/server/midi/types";

/** Every file, whatever its source, is fetched through this one endpoint, so a
 * source without cross origin headers still plays and the page never has to
 * know where the bytes actually live. */
export function fileEndpointOn(
  baseUrl: string,
  source: MidiSourceId,
  id: string,
): string {
  const target = new URL("/api/midi/file", baseUrl);
  target.searchParams.set("source", source);
  target.searchParams.set("id", id);
  return target.toString();
}

/** What a result has to carry to be opened. One rule, since a match the browser
 * found for itself has to open exactly like one the server found: the base is
 * our own address either way, this server's configured one or the one the page
 * is being read from. */
export function searchItem(
  listing: MidiListing,
  baseUrl: string,
): MidiSearchItem {
  const downloadUrl = fileEndpointOn(baseUrl, listing.source, listing.id);
  const link = (mode: PlayerMode) =>
    buildPlayerUrl(baseUrl, mode, {
      url: downloadUrl,
      name: listing.name,
      source: listing.source,
      tracks: null,
      speed: defaultSpeed,
      simplified: false,
      melodyRate: defaultMelodyRate,
      hand: null,
      transpose: defaultTranspose,
      focus: false,
      skin: null,
      rise: false,
      notation: null,
      sheetTheme: null,
      start: defaultStart,
    });
  return {
    ...listing,
    downloadUrl,
    playUrl: link("watch"),
    learnUrl: link("learn"),
    multiplayerUrl: link("multiplayer"),
  };
}
