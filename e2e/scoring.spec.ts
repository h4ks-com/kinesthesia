import { expect, type Page, test } from "@playwright/test";
import { playerQuery, serveFixture, struckKeyCount } from "./fixture";

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
  await expect(flag.first()).toHaveText(/Perfect|Good|Miss|Held short/);

  // The verdict and the mark it leaves on the rail say the same thing, so the
  // flag stands against the middle of the rail. A verdict fades as fast as it
  // pops, so each reading strikes a key of its own rather than hoping the one
  // before is still on screen.
  const rail = await page.locator("[data-rail]").first().boundingBox();
  const middle = (rail?.y ?? 0) + (rail?.height ?? 0) / 2;
  const placement = { offCentre: 0, rightEdge: 0 };
  await expect
    .poll(
      async () => {
        await page.keyboard.press("z");
        const box = await flag
          .first()
          .boundingBox({ timeout: 2000 })
          .catch(() => null);
        if (box === null) {
          return false;
        }
        placement.offCentre = Math.abs(box.y + box.height / 2 - middle);
        placement.rightEdge = box.x + box.width;
        return true;
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  expect(placement.offCentre).toBeLessThan(4);
  expect(placement.rightEdge).toBeLessThanOrEqual(rail?.x ?? 0);
});

test("the rail fills in as notes are judged", async ({ page }) => {
  test.setTimeout(120_000);
  await openLearn(page);
  await expect(page.locator("[data-tick]")).toHaveCount(0);
  await playAlong(page, 2);
  // A rail entry fades, so each reading strikes a key of its own rather than
  // hoping the one the last round left is still on screen.
  await expect
    .poll(
      async () => {
        await page.keyboard.press("z");
        return page.locator("[data-tick]").first().isVisible();
      },
      { timeout: 30_000 },
    )
    .toBe(true);
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

// Watching has nobody at the keys, so the song plays them itself and every
// sounding key reads as pressed rather than merely tinted.
test("watching presses the keys the song is sounding", async ({ page }) => {
  test.setTimeout(120_000);
  await serveFixture(page);
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto(`/watch?${playerQuery()}`);
  await expect(page.locator("canvas").first()).toBeVisible();
  await page.getByRole("button", { name: /play/i }).first().click();

  await expect
    .poll(async () => struckKeyCount(page), { timeout: 30_000 })
    .toBeGreaterThan(0);
});

// The other half of the rule, that a hand's own press is the only thing that may
// sink a key where somebody is playing, has no test here on purpose. Learn only
// diverges in the instant after a gate opens, and every steady moment a spec can
// read is a gate holding still with nothing sounding, so an assertion there
// passes under either rule and would claim cover it does not have. A match would
// show it plainly, and nothing yet drives one from end to end.

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
