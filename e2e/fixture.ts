import type { Page } from "@playwright/test";
import { Midi } from "@tonejs/midi";

export const songUrl = "https://example.test/fixture.mid";
export const songName = "Fixture Song";

/** A short two track song: a held chord line plus a walking melody, enough to
 * exercise falling notes, track colours and the wait gate. */
function buildMidi(): Uint8Array {
  const midi = new Midi();
  const chords = midi.addTrack();
  chords.instrument.number = 0;
  const melody = midi.addTrack();
  melody.instrument.number = 40;

  for (let bar = 0; bar < 8; bar += 1) {
    const time = bar * 1;
    for (const pitch of [48, 52, 55]) {
      chords.addNote({ midi: pitch, time, duration: 0.9, velocity: 0.7 });
    }
    for (let step = 0; step < 4; step += 1) {
      melody.addNote({
        midi: 72 + step * 2,
        time: time + step * 0.25,
        duration: 0.2,
        velocity: 0.8,
      });
    }
  }
  return new Uint8Array(midi.toArray());
}

export async function serveFixture(page: Page): Promise<void> {
  const body = Buffer.from(buildMidi());
  await page.route(songUrl, (route) =>
    route.fulfill({ status: 200, contentType: "audio/midi", body }),
  );
}

export function playerQuery(): string {
  return `url=${encodeURIComponent(songUrl)}&name=${encodeURIComponent(songName)}&source=bitmidi`;
}
