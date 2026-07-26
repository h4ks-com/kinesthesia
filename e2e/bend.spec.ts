import { expect, test } from "@playwright/test";
import { seenTour } from "./fixture";

declare global {
  interface Window {
    sendMidi: (bytes: number[]) => void;
  }
}

type Page = import("@playwright/test").Page;

/** A MIDI device the test drives by hand. Web MIDI is unavailable in a headless
 * browser, so the page gets a stand-in delivering the bytes a wheel and a key
 * would send. */
async function fakeDevice(page: Page): Promise<void> {
  await seenTour(page);
  await page.addInitScript(() => {
    const input: { onmidimessage: ((event: unknown) => void) | null } = {
      onmidimessage: null,
    };
    const access = {
      inputs: new Map([["fake", input]]),
      onstatechange: null,
    };
    Object.defineProperty(navigator, "requestMIDIAccess", {
      configurable: true,
      value: () => Promise.resolve(access),
    });
    window.sendMidi = (bytes: number[]) => {
      input.onmidimessage?.({
        data: new Uint8Array(bytes),
        timeStamp: performance.now(),
      });
    };
  });
}

/** The top of the keybed, found from what was painted rather than assumed, so
 * the note can be sampled by how far it has climbed. */
async function keyboardTop(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (canvas === null) {
      return 0;
    }
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
      return 0;
    }
    const ratio = canvas.width / canvas.clientWidth;
    for (let y = 0; y < canvas.clientHeight; y += 1) {
      const { data } = ctx.getImageData(
        0,
        Math.round(y * ratio),
        canvas.width,
        1,
      );
      let pale = 0;
      for (let pixel = 0; pixel < canvas.width; pixel += 1) {
        const index = pixel * 4;
        if ((data[index] ?? 0) > 120 && (data[index + 2] ?? 0) > 120) {
          pale += 1;
        }
      }
      if (pale > canvas.width * 0.5) {
        return y;
      }
    }
    return 0;
  });
}

/** Horizontal centre of the note's body at a height above the keys. Each height
 * is an age, so this reads where the note was drawn for that moment. */
async function centreAbove(
  page: Page,
  top: number,
  above: number,
): Promise<number | null> {
  return page.evaluate(
    ([keys, rise]) => {
      const canvas = document.querySelector("canvas");
      if (canvas === null) {
        return null;
      }
      const ctx = canvas.getContext("2d");
      if (ctx === null) {
        return null;
      }
      const ratio = canvas.width / canvas.clientWidth;
      const y = Math.round(((keys ?? 0) - (rise ?? 0)) * ratio);
      const { data } = ctx.getImageData(0, y, canvas.width, 1);
      let sum = 0;
      let weight = 0;
      for (let pixel = 0; pixel < canvas.width; pixel += 1) {
        const index = pixel * 4;
        const lit =
          (data[index] ?? 0) + (data[index + 1] ?? 0) + (data[index + 2] ?? 0);
        if (lit > 150) {
          sum += pixel * lit;
          weight += lit;
        }
      }
      return weight === 0 ? null : sum / weight / ratio;
    },
    [top, above],
  );
}

/** The roll scrolls `lookAhead` seconds over the height above the keys, so a
 * height is an age and both can be derived rather than guessed at. */
const lookAhead = 3.5;

async function open(page: Page): Promise<number> {
  await fakeDevice(page);
  await page.goto("/play");
  await expect(page.locator("canvas")).toBeVisible();
  await expect
    .poll(async () => keyboardTop(page), { timeout: 10000 })
    .toBeGreaterThan(0);
  return keyboardTop(page);
}

function rowFor(top: number, secondsAgo: number): number {
  return (top / lookAhead) * secondsAgo;
}

/** Holds a key long enough for its bar to climb, then moves a wheel, so the
 * bar carries both an unbent stretch and a bent one. */
async function strikeThenBend(page: Page, bend: number[]): Promise<void> {
  await page.evaluate(() => window.sendMidi([0x90, 60, 100]));
  await page.waitForTimeout(1400);
  await page.evaluate((bytes) => window.sendMidi(bytes), bend);
  await page.waitForTimeout(500);
}

test("the bend wheel lays the note along the pitch it was played at", async ({
  page,
}) => {
  const top = await open(page);
  await strikeThenBend(page, [0xe0, 0x7f, 0x7f]);

  // The bend landed 0.5s ago over a note held 1.9s, so these rows sit either
  // side of it with room to spare at any viewport.
  const recent = await centreAbove(page, top, rowFor(top, 0.25));
  const older = await centreAbove(page, top, rowFor(top, 1.2));
  expect(recent).not.toBeNull();
  expect(older).not.toBeNull();
  expect(recent ?? 0).toBeGreaterThan((older ?? 0) + 15);
});

test("a bend down lays the note the other way", async ({ page }) => {
  const top = await open(page);
  await strikeThenBend(page, [0xe0, 0x00, 0x00]);

  const recent = await centreAbove(page, top, rowFor(top, 0.25));
  const older = await centreAbove(page, top, rowFor(top, 1.2));
  expect(recent).not.toBeNull();
  expect(older).not.toBeNull();
  expect(recent ?? 0).toBeLessThan((older ?? 0) - 15);
});

test("a wheel on another channel leaves the note alone", async ({ page }) => {
  const top = await open(page);
  // The wheels are channel wide, so a bend on channel 2 must not touch a note
  // played on channel 1.
  await strikeThenBend(page, [0xe1, 0x7f, 0x7f]);

  const recent = await centreAbove(page, top, rowFor(top, 0.25));
  const older = await centreAbove(page, top, rowFor(top, 1.2));
  expect(recent).not.toBeNull();
  expect(Math.abs((recent ?? 0) - (older ?? 0))).toBeLessThan(10);
});
