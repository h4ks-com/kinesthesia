import { describe, expect, it } from "vitest";
import {
  buildPlayerUrl,
  defaultStart,
  type PlayerParams,
  parsePlayerParams,
  playerPath,
} from "@/lib/player-url";

const song: PlayerParams = {
  url: "https://bitmidi.com/uploads/87216.mid",
  name: "Queen - Bohemian Rhapsody",
  source: "bitmidi",
  tracks: null,
  speed: 1,
  simplified: false,
  melodyRate: 6,
  transpose: 0,
  focus: false,
  start: defaultStart,
};

const allowed = ["https://bitmidi.com", "https://x", "https://x.test"];
const parse = (searchParams: URLSearchParams): PlayerParams | null =>
  parsePlayerParams(searchParams, allowed);

describe("buildPlayerUrl", () => {
  it("encodes the song into the mode route", () => {
    const built = new URL(
      buildPlayerUrl("https://kinesthesia.h4ks.com", "watch", song),
    );
    expect(built.pathname).toBe("/watch");
    expect(built.searchParams.get("url")).toBe(song.url);
    expect(built.searchParams.get("name")).toBe(song.name);
    expect(built.searchParams.get("source")).toBe("bitmidi");
  });

  it("omits tracks when none are selected", () => {
    const built = new URL(
      buildPlayerUrl("https://kinesthesia.h4ks.com", "learn", song),
    );
    expect(built.searchParams.has("tracks")).toBe(false);
  });

  it("serialises selected tracks", () => {
    const built = new URL(
      buildPlayerUrl("https://kinesthesia.h4ks.com", "multiplayer", {
        ...song,
        tracks: [0, 3, 7],
      }),
    );
    expect(built.searchParams.get("tracks")).toBe("0,3,7");
  });
});

describe("playerPath", () => {
  it("returns a same origin path", () => {
    expect(playerPath("learn", song)).toMatch(/^\/learn\?/);
  });

  it("survives a song whose own url looks like the internal base", () => {
    const hostile = { ...song, name: "http://player.local weirdness" };
    const path = playerPath("watch", hostile);
    expect(path.startsWith("/watch?")).toBe(true);
    expect(parse(new URL(path, "https://x.test").searchParams)).toEqual(
      hostile,
    );
  });
});

describe("parsePlayerParams", () => {
  it("round trips a built url", () => {
    const withTracks = { ...song, tracks: [1, 2] };
    const built = new URL(
      buildPlayerUrl("https://kinesthesia.h4ks.com", "watch", withTracks),
    );
    expect(parse(built.searchParams)).toEqual(withTracks);
  });

  it("rejects a url that is not http(s)", () => {
    for (const hostile of [
      "javascript:alert(1)",
      "data:text/html,<script>",
      "file:///etc/passwd",
    ]) {
      const params = new URLSearchParams({ url: hostile, name: "x" });
      expect(parse(params)).toBeNull();
    }
  });

  it("returns null when no url is present", () => {
    expect(parse(new URLSearchParams({ name: "x" }))).toBeNull();
  });

  it("plays a url only from an allowed origin", () => {
    const trusted = new URLSearchParams({
      url: "https://x/a.mid",
      name: "ok",
    });
    expect(parse(trusted)?.url).toBe("https://x/a.mid");

    const untrusted = new URLSearchParams({
      url: "https://evil.example/a.mid",
      name: "no",
    });
    expect(parse(untrusted)).toBeNull();
  });

  it("drops track entries that are not positive integers", () => {
    const params = new URLSearchParams({ url: song.url, tracks: "0,abc,-2,3" });
    expect(parse(params)?.tracks).toEqual([0, 3]);
  });
});

describe("focus", () => {
  it("rides in the link only while it is on", () => {
    expect(playerPath("watch", song)).not.toContain("focus");
    expect(playerPath("watch", { ...song, focus: true })).toContain("focus=1");
  });

  it("is read back off the link", () => {
    const path = playerPath("watch", { ...song, focus: true });
    const params = parse(new URLSearchParams(path.slice(path.indexOf("?"))));
    expect(params?.focus).toBe(true);
  });
});

describe("start", () => {
  it("rides in the link only past zero", () => {
    expect(playerPath("watch", song)).not.toContain("start");
    expect(playerPath("watch", { ...song, start: 42.5 })).toContain(
      "start=42.5",
    );
  });

  it("is read back off the link", () => {
    const path = playerPath("watch", { ...song, start: 42.5 });
    const params = parse(new URLSearchParams(path.slice(path.indexOf("?"))));
    expect(params?.start).toBe(42.5);
  });

  it("falls back to the start for a missing or nonsense offset", () => {
    const read = (query: string): number | undefined =>
      parse(new URLSearchParams(`?url=https://x/a.mid${query}`))?.start;
    expect(read("")).toBe(0);
    expect(read("&start=-5")).toBe(0);
    expect(read("&start=abc")).toBe(0);
  });
});
