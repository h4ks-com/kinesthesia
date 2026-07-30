import { expect, test } from "@playwright/test";
import { seenTour } from "./fixture";

declare global {
  interface Window {
    sendMidi: (bytes: number[]) => void;
    /** True once the app has subscribed to the stand-in device. */
    midiListening: boolean;
  }
}

type Page = import("@playwright/test").Page;

/** A MIDI device the test drives by hand. Web MIDI is unavailable in a headless
 * browser, so the page gets a stand-in delivering the bytes a wheel and a key
 * would send. */
async function fakeDevice(page: Page): Promise<void> {
  await seenTour(page);
  await page.addInitScript(() => {
    // A note sent before the app subscribes goes nowhere, so the handler is
    // watched rather than assumed: the test waits for it.
    let handler: ((event: unknown) => void) | null = null;
    const input = {};
    Object.defineProperty(input, "onmidimessage", {
      get: () => handler,
      set: (next: ((event: unknown) => void) | null) => {
        handler = next;
        window.midiListening = next !== null;
      },
    });
    window.midiListening = false;
    const access = {
      inputs: new Map([["fake", input]]),
      onstatechange: null,
    };
    Object.defineProperty(navigator, "requestMIDIAccess", {
      configurable: true,
      value: () => Promise.resolve(access),
    });
    window.sendMidi = (bytes: number[]) => {
      handler?.({
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

/** How wide the lit part of the roll is, above the keys. A bar the wheels sat
 * still through is one note wide; one thrown by a wheel covers more ground.
 * Read across the whole picture rather than at a chosen row, so it does not
 * depend on how far the bar has climbed by the time it is measured. */
async function litWidth(page: Page, top: number): Promise<number> {
  return page.evaluate((keys) => {
    const canvas = document.querySelector("canvas");
    const ctx = canvas?.getContext("2d") ?? null;
    if (canvas === null || ctx === null) {
      return 0;
    }
    const ratio = canvas.width / canvas.clientWidth;
    // Clear of the reach bar, which sits a few pixels above the keys and runs
    // the width of what the computer keyboard can play.
    const height = Math.max(1, Math.round(((keys ?? 0) - 14) * ratio));
    const { data } = ctx.getImageData(0, 0, canvas.width, height);
    let left = canvas.width;
    let right = -1;
    for (let pixel = 0; pixel < canvas.width * height; pixel += 1) {
      const index = pixel * 4;
      const lit =
        (data[index] ?? 0) + (data[index + 1] ?? 0) + (data[index + 2] ?? 0);
      if (lit > 150) {
        const x = pixel % canvas.width;
        left = Math.min(left, x);
        right = Math.max(right, x);
      }
    }
    return right < 0 ? 0 : (right - left) / ratio;
  }, top);
}

async function open(page: Page): Promise<number> {
  await fakeDevice(page);
  await page.goto("/play");
  await expect(page.locator("canvas")).toBeVisible();
  await expect
    .poll(async () => keyboardTop(page), { timeout: 10000 })
    .toBeGreaterThan(0);
  await expect
    .poll(() => page.evaluate(() => window.midiListening), { timeout: 10000 })
    .toBe(true);
  return keyboardTop(page);
}

/** Which way a wheel throws a note, and how far, is arithmetic and is asserted
 * exactly in src/lib/render/bend-shape.test.ts. What is left for a browser is
 * whether the bytes a device sends reach the drawing at all. */
test("a wheel the device sends reaches the roll", async ({ page }) => {
  const top = await open(page);
  await page.evaluate(() => window.sendMidi([0x90, 60, 100]));
  await page.waitForTimeout(1400);
  const straight = await litWidth(page, top);

  await page.evaluate(() => window.sendMidi([0xe0, 0x7f, 0x7f]));
  await page.waitForTimeout(600);

  expect(await litWidth(page, top)).toBeGreaterThan(straight + 10);
});

test("a wheel on another channel leaves the note alone", async ({ page }) => {
  const top = await open(page);
  await page.evaluate(() => window.sendMidi([0x90, 60, 100]));
  await page.waitForTimeout(1400);
  const straight = await litWidth(page, top);

  // Nothing lit would satisfy the comparison below on its own.
  expect(straight).toBeGreaterThan(0);

  // The wheels are channel wide, so a bend on channel 2 must not touch a note
  // played on channel 1.
  await page.evaluate(() => window.sendMidi([0xe1, 0x7f, 0x7f]));
  await page.waitForTimeout(600);

  expect(await litWidth(page, top)).toBeLessThan(straight + 10);
});
