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
      {state.status}:{"results" in state ? state.results.length : 0}
    </p>
  );
}

function stubSearch(): ReturnType<typeof vi.fn> {
  const fetching = vi.fn(async () => ({
    ok: true,
    json: async () => ({ results: found }),
  }));
  vi.stubGlobal("fetch", fetching);
  return fetching;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("useLiveSearch", () => {
  it("comes back to a finished search without asking the sources again", async () => {
    const fetching = stubSearch();
    const first = render(<Search query="moonlight" />);
    await waitFor(() => expect(fetching).toHaveBeenCalledTimes(1));
    await screen.findByText("done:1");
    first.unmount();

    expect(lastSearchQuery()).toBe("moonlight");
    render(<Search query={lastSearchQuery()} />);
    expect(screen.getByText("done:1")).toBeTruthy();
    // Long enough for a fresh search to have settled and left.
    await new Promise((done) => setTimeout(done, 700));
    expect(fetching).toHaveBeenCalledTimes(1);
  });

  it("searches again the moment the words change", async () => {
    const fetching = stubSearch();
    const { rerender } = render(<Search query="clair de lune" />);
    await waitFor(() => expect(fetching).toHaveBeenCalledTimes(1));
    await screen.findByText("done:1");

    rerender(<Search query="clair de lune arranged" />);
    await waitFor(() => expect(fetching).toHaveBeenCalledTimes(2));
  });

  it("forgets the search once the box is emptied", async () => {
    const fetching = stubSearch();
    const { rerender } = render(<Search query="gymnopedie" />);
    await waitFor(() => expect(fetching).toHaveBeenCalledTimes(1));
    await screen.findByText("done:1");

    rerender(<Search query="" />);
    await screen.findByText("idle:0");
    expect(lastSearchQuery()).toBe("");
  });
});
