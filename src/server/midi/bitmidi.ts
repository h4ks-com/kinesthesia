import {
  bitmidiBase,
  bitmidiFileUrl,
  searchBitmidi,
} from "@/lib/midi/sources/bitmidi";
import { sourceFetch } from "@/server/http/fetch";
import type { MidiSource } from "@/server/midi/types";

// Cloudflare answers the default fetch User-Agent with a 520; a browser one is
// served. Only set here: a browser asking for itself sends its own, and this is
// one of the headers it refuses to let a page choose.
const browserUserAgent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36";

export const bitmidiSource: MidiSource = {
  id: "bitmidi",
  label: "BitMidi",
  blurb:
    "A large open catalogue of user submitted MIDI files, mostly popular songs and games.",
  homeUrl: bitmidiBase,
  license: "User submitted; check each song's own rights before reuse.",

  fileUrl: bitmidiFileUrl,

  search(query) {
    return searchBitmidi(query, (url) =>
      sourceFetch(url, { headers: { "User-Agent": browserUserAgent } }),
    );
  },
};
