import { expect, test } from "@playwright/test";
import { playerQuery, seenTour, serveFixture } from "./fixture";

/** The map is painted once into a background image, so what that image is set
 * to is the thing that says the song was drawn and redrawn. */
const painted = 'footer [style*="background-image"]';
const playhead = 'footer [style*="translateX"]';

async function openWatch(page: import("@playwright/test").Page): Promise<void> {
  await seenTour(page);
  await serveFixture(page);
  await page.goto(`/watch?${playerQuery()}`);
  await expect(page.getByRole("img", { name: /Piano roll/ })).toBeVisible();
  await expect(page.locator(painted).first()).toBeVisible();
}

test("the timeline draws the whole song", async ({ page }) => {
  await openWatch(page);

  // Two passes of the same picture, one for the played material and one for
  // what is still to come.
  await expect(page.locator(painted)).toHaveCount(2);
  const image = await page.locator(painted).first().getAttribute("style");
  expect(image).toContain("data:image/png");
});

test("it redraws when the shown tracks change", async ({ page }) => {
  await openWatch(page);
  const before = await page.locator(painted).first().getAttribute("style");

  await page.getByRole("button", { name: "Tracks" }).first().click();
  await page
    .getByRole("button", { name: /^Show only / })
    .first()
    .click();
  await page.keyboard.press("Escape");

  await expect
    .poll(() => page.locator(painted).first().getAttribute("style"))
    .not.toBe(before);
});

// The old scrubber stepped a whole second at a time because it was driven from
// React state. This is what says the playhead is on the audio clock instead.
test("the playhead moves between frames while playing", async ({ page }) => {
  await openWatch(page);
  await page.getByRole("button", { name: "Play" }).click();

  const positions: string[] = [];
  for (let sample = 0; sample < 4; sample += 1) {
    await page.waitForTimeout(120);
    positions.push(
      (await page.locator(playhead).getAttribute("style")) ?? "none",
    );
  }

  expect(new Set(positions).size).toBeGreaterThan(2);
});

test("seeking by the keyboard moves the song", async ({ page }) => {
  await openWatch(page);
  const seek = page.getByRole("slider", { name: "Song position" });

  await seek.focus();
  for (let press = 0; press < 6; press += 1) {
    await seek.press("ArrowRight");
  }

  await expect(page.getByText(/0:0[1-9]/)).toBeVisible();
});
