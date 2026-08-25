import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { lastSearchQuery, useLiveSearch } from "@/lib/use-live-search";
import type { MidiSearchItem } from "@/server/midi/types";

const found: MidiSearchItem[] = [
  {
    id: "1",
    name: "moonlight.mid",
    source: "bitmidi",
    sourceUrl: "https://bitmidi.test/1",
    downloadUrl: "https://files.test/moonlight.mid",
    playUrl: "/watch?url=1",
    learnUrl: "/learn?url=1",
    multiplayerUrl: "/multiplayer?url=1",
    plays: 0,
  },
];

function Search({ query }: { query: string }) {
  const state = useLiveSearch(query);
  return (
    <p>
      {`${state.status}:${"results" in state ? state.results.length : 0}:${
        "missing" in state ? state.missing.join(",") : ""
      }`}
    </p>
  );
}

/** Our own endpoint and BitMidi's are both asked on every search, so a stub has
 * to answer in each shape and a count of searches is a count of the ours. */
function stubSearch(
  ours: () => unknown = () => ({ results: found }),
  theirs: () => unknown = () => ({ result: { results: [] } }),
): ReturnType<typeof vi.fn> {
  const fetching = vi.fn(async (url: string) =>
    String(url).startsWith("/api/midi/search")
      ? { ok: true, json: async () => ours() }
      : { ok: true, json: async () => theirs() },
  );
  vi.stubGlobal("fetch", fetching);
  return fetching;
}

function searches(fetching: ReturnType<typeof vi.fn>): number {
  return fetching.mock.calls.filter((call) =>
    String(call[0]).startsWith("/api/midi/search"),
  ).length;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("useLiveSearch", () => {
  it("comes back to a finished search without asking the sources again", async () => {
    const fetching = stubSearch();
    const first = render(<Search query="moonlight" />);
    await waitFor(() => expect(searches(fetching)).toBe(1));
    await screen.findByText("done:1:");
    first.unmount();

    expect(lastSearchQuery()).toBe("moonlight");
    render(<Search query={lastSearchQuery()} />);
    expect(screen.getByText("done:1:")).toBeTruthy();
    // Long enough for a fresh search to have settled and left.
    await new Promise((done) => setTimeout(done, 700));
    expect(searches(fetching)).toBe(1);
  });

  it("searches again the moment the words change", async () => {
    const fetching = stubSearch();
    const { rerender } = render(<Search query="clair de lune" />);
    await waitFor(() => expect(searches(fetching)).toBe(1));
    await screen.findByText("done:1:");

    rerender(<Search query="clair de lune arranged" />);
    await waitFor(() => expect(searches(fetching)).toBe(2));
  });

  it("forgets the search once the box is emptied", async () => {
    const fetching = stubSearch();
    const { rerender } = render(<Search query="gymnopedie" />);
    await waitFor(() => expect(searches(fetching)).toBe(1));
    await screen.findByText("done:1:");

    rerender(<Search query="" />);
    await screen.findByText("idle:0:");
    expect(lastSearchQuery()).toBe("");
  });
  // Their Cloudflare turns our server away and serves a reader's own address,
  // so a search the server came back empty from still finds the catalogue.
  it("finds what the server could not reach, from the browser itself", async () => {
    stubSearch(
      () => ({ results: [] }),
      () => ({
        result: {
          results: [
            {
              id: 42,
              name: "chandelier.mid",
              plays: 7,
              downloadUrl: "/uploads/42.mid",
              url: "/chandelier-mid",
            },
          ],
        },
      }),
    );
    render(<Search query="chandelier" />);
    await screen.findByText("done:1:");
  });

  it("shows a listing once where both found it", async () => {
    stubSearch(
      () => ({ results: found }),
      () => ({
        result: {
          results: [
            {
              id: 1,
              name: "moonlight.mid",
              plays: 0,
              downloadUrl: "/uploads/1.mid",
              url: "/moonlight-mid",
            },
          ],
        },
      }),
    );
    render(<Search query="moonlight" />);
    await screen.findByText("done:1:");
  });
  // A source that stalls must not blank what the others found, and a short list
  // has to say why it is short.
  it("keeps what the server found and names the source that stayed silent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).startsWith("/api/midi/search")) {
          return { ok: true, json: async () => ({ results: found }) };
        }
        throw new Error("stalled");
      }),
    );
    render(<Search query="arabesque" />);
    await screen.findByText("done:1:BitMidi");
  });
});
