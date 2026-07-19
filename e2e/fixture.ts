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

export const keyRowFromBottom = 6;
const idleKeyColor = [223, 228, 236] as const;

/** Finds the middle of each pale run along one row of the keyboard, which is
 * one run per visible white key, so both the count and the positions come from
 * what was actually painted rather than from assumed geometry. */
export async function whiteKeyCentres(page: Page): Promise<number[]> {
  return page.evaluate((fromBottom) => {
    const canvas = document.querySelector("canvas");
    if (canvas === null) {
      return [];
    }
    const context = canvas.getContext("2d");
    if (context === null) {
      return [];
    }
    const ratio = canvas.width / canvas.clientWidth;
    const row = Math.round((canvas.clientHeight - fromBottom) * ratio);
    const { data } = context.getImageData(0, row, canvas.width, 1);
    const centres: number[] = [];
    let start: number | null = null;
    for (let pixel = 0; pixel <= canvas.width; pixel += 1) {
      const index = pixel * 4;
      const pale =
        pixel < canvas.width &&
        (data[index] ?? 0) > 150 &&
        (data[index + 2] ?? 0) > 150;
      if (pale && start === null) {
        start = pixel;
      }
      if (!pale && start !== null) {
        centres.push((start + pixel) / 2 / ratio);
        start = null;
      }
    }
    return centres;
  }, keyRowFromBottom);
}

export async function pixelAt(
  page: Page,
  x: number,
  y: number,
): Promise<number[]> {
  return page.evaluate(
    ([localX, localY]) => {
      const canvas = document.querySelector("canvas");
      if (canvas === null) {
        return [0, 0, 0];
      }
      const context = canvas.getContext("2d");
      if (context === null) {
        return [0, 0, 0];
      }
      const ratio = canvas.width / canvas.clientWidth;
      const { data } = context.getImageData(
        Math.round((localX ?? 0) * ratio),
        Math.round((localY ?? 0) * ratio),
        1,
        1,
      );
      return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0];
    },
    [x, y],
  );
}

/** Every track colour keeps at least one channel below 250, so pure white marks
 * a key the player is holding rather than one the song is sounding. */
export async function isPureWhite(page: Page, x: number): Promise<boolean> {
  const canvas = await page.locator("canvas").boundingBox();
  const pixel = await pixelAt(
    page,
    x,
    (canvas?.height ?? 0) - keyRowFromBottom,
  );
  return pixel.every((channel) => channel >= 250);
}

/** The centre of the first white key the song is sounding, which is the key the
 * player owes while the gate waits. */
export async function litKeyCentre(page: Page): Promise<number | null> {
  const centres = await whiteKeyCentres(page);
  for (const centre of centres) {
    if (await keyIsLit(page, centre)) {
      return centre;
    }
  }
  return null;
}

/** A struck key is repainted in its track colour, which is pale but tinted, so
 * only the distance from the resting key tells the two apart. */
export async function keyIsLit(page: Page, x: number): Promise<boolean> {
  const canvas = await page.locator("canvas").boundingBox();
  const pixel = await pixelAt(
    page,
    x,
    (canvas?.height ?? 0) - keyRowFromBottom,
  );
  const distance = idleKeyColor.reduce(
    (total, channel, index) => total + Math.abs((pixel[index] ?? 0) - channel),
    0,
  );
  return distance > 25;
}

/** One measure of how much of the song is drawn as yours, since ghosted notes
 * are painted faintly. */
/** Left edge of the accent bar marking what the computer keyboard reaches,
 * read off the strip just above the keys. Null when no bar is drawn. */
export async function reachBarLeft(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const context = canvas?.getContext("2d") ?? null;
    if (canvas === null || context === null) {
      return null;
    }
    const ratio = canvas.width / canvas.clientWidth;
    const band = Math.min(120, canvas.clientHeight * 0.22) * ratio;
    for (let above = 2; above < 10; above += 1) {
      const y = Math.round(canvas.height - band - above);
      const { data } = context.getImageData(0, y, canvas.width, 1);
      for (let x = 0; x < canvas.width; x += 1) {
        const red = data[x * 4] ?? 0;
        const green = data[x * 4 + 1] ?? 0;
        const blue = data[x * 4 + 2] ?? 0;
        if (blue > 180 && green > 110 && green < 200 && red < 130) {
          return Math.round(x / ratio);
        }
      }
    }
    return null;
  });
}

export async function brightNotePixels(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (canvas === null) {
      return 0;
    }
    const context = canvas.getContext("2d");
    if (context === null) {
      return 0;
    }
    const height = Math.round(canvas.height * 0.6);
    const { data } = context.getImageData(0, 0, canvas.width, height);
    let bright = 0;
    for (let index = 0; index < data.length; index += 4) {
      if ((data[index + 1] ?? 0) > 120) {
        bright += 1;
      }
    }
    return bright;
  });
}
