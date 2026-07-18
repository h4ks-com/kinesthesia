import { expect, type Page, test } from "@playwright/test";
import { playerQuery, serveFixture } from "./fixture";

const widths = [1440, 1024, 768, 480, 390, 360];

async function overflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth - root.clientWidth;
  });
}

test.describe("nothing overflows sideways", () => {
  for (const width of widths) {
    test(`home at ${width}px`, async ({ page }) => {
      await page.route("**/api/midi/search**", (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            results: Array.from({ length: 4 }, (_unused, index) => ({
              id: String(index),
              source: "bitmidi",
              name: "A Very Long Song Title That Should Truncate Rather Than Push",
              plays: 1234567,
              downloadUrl: "https://example.test/fixture.mid",
              sourceUrl: "https://example.test/song",
              playUrl: `/watch?${playerQuery()}`,
            })),
          }),
        }),
      );
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/");
      await page.getByLabel("Search for a song").fill("long title");
      await page.waitForSelector("li");
      expect(await overflow(page)).toBe(0);
    });

    test(`watch at ${width}px`, async ({ page }) => {
      await serveFixture(page);
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/watch?${playerQuery()}`);
      await page.waitForSelector("canvas");
      expect(await overflow(page)).toBe(0);
    });
  }

  test("the track menu stays inside the screen", async ({ page }) => {
    await serveFixture(page);
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto(`/watch?${playerQuery()}`);
    await page.waitForSelector("canvas");
    await page.getByRole("button", { name: "Tracks" }).click();

    const menu = page.locator("div.rise");
    await expect(menu).toBeVisible();
    // A clipped element still reports a wide scrollWidth, so assert on what the
    // user would actually see: no sideways scrollbar.
    expect(
      await menu.evaluate((node) => getComputedStyle(node).overflowX),
    ).not.toBe("auto");
    expect(
      await menu.evaluate((node) => getComputedStyle(node).overflowX),
    ).not.toBe("scroll");
    const box = await menu.boundingBox();
    expect(box).not.toBeNull();
    if (box !== null) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
    }
  });

  test("the settings menu opens upward and stays on screen", async ({
    page,
  }) => {
    await serveFixture(page);
    await page.setViewportSize({ width: 800, height: 700 });
    await page.goto(`/watch?${playerQuery()}`);
    await page.waitForSelector("canvas");
    await page.getByRole("button", { name: "Settings" }).click();

    const box = await page.locator("div.rise").boundingBox();
    expect(box).not.toBeNull();
    if (box !== null) {
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(700);
    }
  });
});
