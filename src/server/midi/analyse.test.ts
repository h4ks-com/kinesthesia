import { Midi } from "@tonejs/midi";
import { describe, expect, it, vi } from "vitest";

const midi = new Midi();
const piano = midi.addTrack();
piano.instrument.number = 0;
const drums = midi.addTrack();
drums.channel = 9;
for (let bar = 0; bar < 4; bar += 1) {
  for (const pitch of [60, 64, 67]) {
    piano.addNote({ midi: pitch, time: bar, duration: 0.5 });
  }
  drums.addNote({ midi: 38, time: bar, duration: 0.1 });
}
const file = new Uint8Array(midi.toArray());

vi.mock("@/server/http/fetch", () => ({
  sourceFetch: vi.fn(async (url: string) =>
    url.includes("missing")
      ? new Response("", { status: 404 })
      : new Response(file),
  ),
}));

const { analyseMidi } = await import("@/server/midi/analyse");

describe("analyseMidi", () => {
  it("reports what the file holds", async () => {
    const summary = await analyseMidi("https://example.test/a.mid", "A song");

    expect(summary.name).toBe("A song");
    expect(summary.notes).toBe(16);
    expect(summary.duration).toBeGreaterThan(0);
    expect(summary.lowestPitch).toBe(38);
    expect(summary.highestPitch).toBe(67);
  });

  it("names each track, so a caller can choose one to play", async () => {
    const summary = await analyseMidi("https://example.test/a.mid", "A song");

    expect(summary.tracks).toHaveLength(2);
    expect(summary.tracks[0]?.notes).toBe(12);
    expect(summary.tracks[1]?.percussion).toBe(true);
    // The busiest line is what the player claims on its own.
    expect(summary.playedTrack).toBe(summary.tracks[0]?.index);
  });

  it("says so when the file cannot be had", async () => {
    await expect(
      analyseMidi("https://example.test/missing.mid", ""),
    ).rejects.toThrow(/status 404/);
  });
});
