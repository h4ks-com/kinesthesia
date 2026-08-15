import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SongInfoPanel } from "@/components/song-info-panel";
import type { Digest } from "@/lib/midi/analysis";

const report: Digest = {
  name: "Fixture Song",
  durationSeconds: 90,
  totalNotes: 64,
  tempo: { bpm: 100, explicit: true, changes: 1 },
  meter: { beats: 4, value: 4, explicit: false, changes: 0 },
  key: {
    tonic: "C",
    mode: "major",
    correlation: 0.82,
    margin: 0.12,
    runnerUp: "A minor",
  },
  tracks: [
    {
      index: 0,
      name: "Piano",
      instrument: "acoustic grand piano",
      percussion: false,
      notes: 48,
      range: ["C3", "G4"],
    },
    {
      index: 1,
      name: "Kit",
      instrument: "standard kit",
      percussion: true,
      notes: 16,
      range: ["C2", "C2"],
    },
  ],
  playedTrack: 0,
  lowestPitch: 36,
  highestPitch: 79,
  density: 0.7,
  harmony: [
    { bars: "1-4", chord: "C" },
    { bars: "5-8", chord: "G" },
  ],
};

describe("SongInfoPanel", () => {
  it("shows the song's name, tempo, meter, key and duration", () => {
    render(
      <SongInfoPanel title="Fixture Song" report={report} onClose={vi.fn()} />,
    );

    expect(screen.getByText("Fixture Song")).toBeTruthy();
    expect(screen.getByText("1:30")).toBeTruthy();
    expect(screen.getByText("100 bpm")).toBeTruthy();
    expect(screen.getByText("4/4")).toBeTruthy();
    expect(screen.getByText("assumed")).toBeTruthy();
    expect(screen.getByText("C major")).toBeTruthy();
    expect(screen.getByText("82% fit")).toBeTruthy();
  });

  it("lists every track with its note count, range and percussion", () => {
    render(
      <SongInfoPanel title="Fixture Song" report={report} onClose={vi.fn()} />,
    );

    expect(screen.getByText("Piano")).toBeTruthy();
    expect(screen.getByText(/C3–G4 · 48 · busiest/)).toBeTruthy();
    expect(screen.getByText("Kit")).toBeTruthy();
    expect(screen.getByText(/C2–C2 · 16/)).toBeTruthy();
  });

  it("lists the chord progression as bar ranges", () => {
    render(
      <SongInfoPanel title="Fixture Song" report={report} onClose={vi.fn()} />,
    );

    expect(screen.getByText("1-4")).toBeTruthy();
    expect(screen.getByText("5-8")).toBeTruthy();
  });

  it("says so when no chords were detected", () => {
    render(
      <SongInfoPanel
        title="Fixture Song"
        report={{ ...report, harmony: [] }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("No chords detected.")).toBeTruthy();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <SongInfoPanel title="Fixture Song" report={report} onClose={onClose} />,
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes from its own close button", () => {
    const onClose = vi.fn();
    render(
      <SongInfoPanel title="Fixture Song" report={report} onClose={onClose} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("says when a key could not be found", () => {
    render(
      <SongInfoPanel
        title="Fixture Song"
        report={{ ...report, key: null }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("unclear")).toBeTruthy();
  });
});
