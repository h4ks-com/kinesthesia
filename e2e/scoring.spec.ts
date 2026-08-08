import { expect, type Page, test } from "@playwright/test";
import {
  isStruckKey,
  litKeyCentre,
  playerQuery,
  serveFixture,
} from "./fixture";

/** Every white key the computer keyboard reaches, so a run of them is certain
 * to include whatever the song is asking for. */
const whiteRow = ["z", "x", "c", "v", "b", "n", "m", "q", "w", "e", "r", "t"];

async function playAlong(page: Page, rounds: number): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    for (const key of whiteRow) {
      await page.keyboard.press(key);
      await page.waitForTimeout(45);
    }
  }
}

async function openLearn(page: Page): Promise<void> {
  await serveFixture(page);
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto(`/learn?${playerQuery()}&tracks=0`);
  await expect(page.locator("canvas").first()).toBeVisible();
  await page.getByRole("button", { name: /play/i }).first().click();
}

test("a strike is judged and says so over the keys", async ({ page }) => {
  test.setTimeout(120_000);
  await openLearn(page);
  await playAlong(page, 2);

  const flag = page.locator(".pop");
  await expect(flag.first()).toBeVisible();
  await expect(flag.first()).toHaveText(/Perfect|Good|Miss|Let go/);

  // The verdict belongs where the eyes are as a note lands, which is the keys
  // at the foot of the roll rather than the top of the screen.
  const box = await flag.first().boundingBox();
  const view = page.viewportSize();
  expect(box).not.toBeNull();
  expect(box?.y ?? 0).toBeGreaterThan((view?.height ?? 0) / 2);
});

test("the rail fills in as notes are judged", async ({ page }) => {
  test.setTimeout(120_000);
  await openLearn(page);
  await expect(page.locator(".fade-out")).toHaveCount(0);
  await playAlong(page, 2);
  await expect(page.locator(".fade-out").first()).toBeVisible();
});

// Which verdict a strike earns is settled by the gates, and the hook's own
// tests pin every case. What only a browser can answer is whether a key press
// reaches them at all, so that is what this asks.
test("a key nothing asked for is judged, not ignored", async ({ page }) => {
  test.setTimeout(120_000);
  await openLearn(page);
  await expect(page.locator(".pop")).toHaveCount(0);
  await playAlong(page, 1);
  await expect(page.locator(".pop").first()).toHaveText(/Miss|Perfect|Good/);
});

// The roll used to sink and shadow keys the song was sounding, which reads as
// the game pressing them for you.
test("watching never presses a key for you", async ({ page }) => {
  test.setTimeout(120_000);
  await serveFixture(page);
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto(`/watch?${playerQuery()}`);
  await expect(page.locator("canvas").first()).toBeVisible();
  await page.getByRole("button", { name: /play/i }).first().click();
  await page.waitForTimeout(3400);

  const lit = await litKeyCentre(page);
  expect(lit).not.toBeNull();
  // A key the song is sounding carries its part's colour without wearing the
  // full-strength one a hand puts on it.
  expect(await isStruckKey(page, lit ?? 0)).toBe(false);
});

test("the rail rides the right of both rolls, whatever the width", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await serveFixture(page);
  for (const width of [1400, 620]) {
    await page.setViewportSize({ width, height: 820 });
    await page.goto(`/learn?${playerQuery()}&tracks=0`);
    await expect(page.locator("canvas").first()).toBeVisible();
    await page.getByRole("button", { name: /play/i }).first().click();
    await playAlong(page, 1);
    const rail = page.locator("[data-rail]").first();
    await expect(rail).toBeVisible();
    const box = await rail.boundingBox();
    // Upright at every width, and against the right edge of the roll.
    expect(box?.height ?? 0).toBeGreaterThan(box?.width ?? 0);
    const roll = await page.locator("canvas").first().boundingBox();
    expect(box?.x ?? 0).toBeGreaterThan(
      (roll?.x ?? 0) + (roll?.width ?? 0) / 2,
    );
  }
});
