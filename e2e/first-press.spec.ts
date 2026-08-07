import { expect, test } from "@playwright/test";
import { seenTour } from "./fixture";

declare global {
  interface Window {
    __started: number[];
  }
}

/** Counts the buffer sources that actually start, which is the only honest
 * answer to whether a press made a sound. */
async function watchSound(
  page: import("@playwright/test").Page,
): Promise<void> {
  await page.addInitScript(() => {
    const started: number[] = [];
    window.__started = started;
    const make = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function patched(
      this: AudioContext,
    ) {
      const node = make.call(this);
      const start = node.start.bind(node);
      // Every argument forwarded: the sampler starts from an offset, and
      // swallowing it here would sound a different note than production does.
      node.start = (when?: number, offset?: number, duration?: number) => {
        started.push(1);
        start(when, offset, duration);
      };
      return node;
    };
  });
}

function sounds(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(() => window.__started.length);
}

/** A voice asked for before it is built answers with nothing and starts
 * building, so the whole working set is brought in up front. Without that the
 * first press of a session is silent and only the second one sounds. */
test("the very first key press makes a sound", async ({ page }) => {
  test.setTimeout(120000);
  await seenTour(page);
  await watchSound(page);
  await page.goto("/play");
  await page.locator("canvas").first().waitFor({ state: "visible" });
  // A gesture of its own first, so the device is already running and this is
  // a test of the instrument rather than of the browser's autoplay rule.
  await page.mouse.click(5, 5);
  await page.waitForTimeout(2500);

  const box = await page.locator("canvas").first().boundingBox();
  const keys = (box?.y ?? 0) + (box?.height ?? 0) - 20;
  await page.mouse.click((box?.x ?? 0) + (box?.width ?? 0) * 0.4, keys);
  await expect.poll(() => sounds(page)).toBeGreaterThan(0);

  const afterFirst = await sounds(page);
  await page.mouse.click((box?.x ?? 0) + (box?.width ?? 0) * 0.42, keys);
  await expect.poll(() => sounds(page)).toBeGreaterThan(afterFirst);
});
