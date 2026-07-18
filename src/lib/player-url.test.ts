import { describe, expect, it } from "vitest";
import {
  buildPlayerUrl,
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
};

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
      buildPlayerUrl("https://kinesthesia.h4ks.com", "battle", {
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
    expect(
      parsePlayerParams(new URL(path, "https://x.test").searchParams),
    ).toEqual(hostile);
  });
});

describe("parsePlayerParams", () => {
  it("round trips a built url", () => {
    const withTracks = { ...song, tracks: [1, 2] };
    const built = new URL(
      buildPlayerUrl("https://kinesthesia.h4ks.com", "watch", withTracks),
    );
    expect(parsePlayerParams(built.searchParams)).toEqual(withTracks);
  });

  it("rejects a url that is not http(s)", () => {
    for (const hostile of [
      "javascript:alert(1)",
      "data:text/html,<script>",
      "file:///etc/passwd",
    ]) {
      const params = new URLSearchParams({ url: hostile, name: "x" });
      expect(parsePlayerParams(params)).toBeNull();
    }
  });

  it("returns null when no url is present", () => {
    expect(parsePlayerParams(new URLSearchParams({ name: "x" }))).toBeNull();
  });

  it("drops track entries that are not positive integers", () => {
    const params = new URLSearchParams({ url: song.url, tracks: "0,abc,-2,3" });
    expect(parsePlayerParams(params)?.tracks).toEqual([0, 3]);
  });
});
