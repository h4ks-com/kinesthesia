import { expect, test } from "@playwright/test";
import { playerQuery, serveFixture } from "./fixture";

async function openHalf(page: import("@playwright/test").Page): Promise<void> {
  await page.getByRole("button", { name: "Notation view" }).click();
  await page.getByRole("button", { name: "Half" }).click();
}

test("the notation view opens and draws real notation", async ({ page }) => {
  await serveFixture(page);
  await page.goto(`/watch?${playerQuery()}`);
  await expect(page.locator("canvas")).toBeVisible();

  await openHalf(page);

  const sheet = page.getByTestId("sheet-view");
  await expect(sheet).toBeVisible();

  // A blank container proves nothing; real notation draws a nontrivial
  // number of SVG paths (noteheads, stems, staff lines, clefs).
  const paths = sheet.locator("svg path");
  await expect
    .poll(async () => paths.count(), { timeout: 15_000 })
    .toBeGreaterThan(20);
});

test("switching to full replaces the roll with notation alone", async ({
  page,
}) => {
  await serveFixture(page);
  await page.goto(`/watch?${playerQuery()}`);
  await expect(page.locator("canvas")).toBeVisible();

  await page.getByRole("button", { name: "Notation view" }).click();
  await page.getByRole("button", { name: "Full" }).click();

  await expect(page.getByTestId("sheet-view")).toBeVisible();
  // The roll's canvas is gone entirely in full notation view.
  await expect(page.locator("canvas")).toHaveCount(0);
});

test("the notation cursor moves as playback advances", async ({ page }) => {
  await serveFixture(page);
  await page.goto(`/watch?${playerQuery()}`);
  await expect(page.locator("canvas")).toBeVisible();

  await openHalf(page);
  const sheet = page.getByTestId("sheet-view");
  const cursor = sheet.locator("img");
  await expect(cursor).toBeAttached({ timeout: 15_000 });

  const startLeft = await cursor.evaluate((node) => node.style.left);

  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect
    .poll(async () => cursor.evaluate((node) => node.style.left), {
      timeout: 20_000,
    })
    .not.toBe(startLeft);
});

test("half and full layouts", async ({ page }) => {
  await serveFixture(page);
  await page.goto(`/watch?${playerQuery()}`);
  await expect(page.locator("canvas")).toBeVisible();

  await openHalf(page);
  const sheet = page.getByTestId("sheet-view");
  await expect(sheet).toBeVisible();
  await expect
    .poll(async () => sheet.locator("svg path").count())
    .toBeGreaterThan(20);
  await page.keyboard.press("Escape");
  await page.screenshot({ path: "/tmp/sheet-half.png" });

  // The popover stays open after picking Half, so Full is already reachable.
  await page.getByRole("button", { name: "Notation view" }).click();
  await page.getByRole("button", { name: "Full" }).click();
  await expect(sheet).toBeVisible();
  await expect
    .poll(async () => sheet.locator("svg path").count())
    .toBeGreaterThan(20);
  await page.keyboard.press("Escape");
  await page.screenshot({ path: "/tmp/sheet-full.png" });
});

test("a song the notation view fails to fetch shows a plain message, not a broken player", async ({
  page,
}) => {
  await serveFixture(page);
  // The player's own load succeeds on the first fetch (serveFixture's
  // route, deferred to via fallback); the notation view re-fetches the same
  // MIDI independently when it opens, and that second fetch is made to fail,
  // proving the roll keeps working even though notation could not load.
  let calls = 0;
  await page.route("https://example.test/fixture.mid", (route) => {
    calls += 1;
    if (calls === 1) {
      return route.fallback();
    }
    return route.fulfill({ status: 500, body: "boom" });
  });

  await page.goto(`/watch?${playerQuery()}`);
  await expect(page.locator("canvas")).toBeVisible();

  await openHalf(page);
  const sheet = page.getByTestId("sheet-view");
  await expect(sheet).toContainText("Could not download that MIDI");
  // The roll is unaffected by the notation view's own failure.
  await expect(page.locator("canvas")).toBeVisible();
});
