import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    __audioState: () => AudioContextState | "none";
  }
}

/** Reports the state of whatever audio device the page built, so a test can ask
 * whether it is actually running without reaching into the app. */
const watchAudio = () => {
  let made: AudioContext | null = null;
  const Real = window.AudioContext;
  class Watched extends Real {
    constructor(options?: AudioContextOptions) {
      super(options);
      made = this;
    }
  }
  window.AudioContext = Watched;
  window.__audioState = () => made?.state ?? "none";
};

test("a plain gesture starts the device, since a midi key never can", async ({
  page,
}) => {
  await page.addInitScript(watchAudio);
  await page.goto("/play");
  await expect(page.locator("canvas")).toBeVisible();

  // Nothing has been touched yet, so the browser has no reason to allow sound.
  expect(await page.evaluate(() => window.__audioState())).toBe("suspended");

  await page
    .locator("canvas")
    .first()
    .click({ position: { x: 20, y: 20 } });

  await expect
    .poll(async () => page.evaluate(() => window.__audioState()), {
      timeout: 15_000,
    })
    .toBe("running");

  // Still inviting a first note, so the device was started by the gesture
  // rather than by anything the click played.
  await expect(
    page.getByText("press a key or tap to start the sound"),
  ).toBeVisible();
});
