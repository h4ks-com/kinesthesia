import { expect, test } from "@playwright/test";
import { playerQuery, serveFixture, settingStored } from "./fixture";

async function openHalf(page: import("@playwright/test").Page): Promise<void> {
  await page.getByRole("button", { name: "View" }).click();
  await page.getByRole("button", { name: "Split", exact: true }).click();
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

  await page.getByRole("button", { name: "View" }).click();
  await page.getByRole("button", { name: "Sheet only", exact: true }).click();

  await expect(page.getByTestId("sheet-view")).toBeVisible();
  // The roll's canvas is gone entirely in full notation view.
  await expect(page.locator("canvas")).toHaveCount(0);
});

test("the current and next cursors move as playback advances, one onset apart", async ({
  page,
}) => {
  await serveFixture(page);
  await page.goto(`/watch?${playerQuery()}`);
  await expect(page.locator("canvas")).toBeVisible();

  await openHalf(page);
  const sheet = page.getByTestId("sheet-view");
  const now = sheet.locator("img").first();
  const next = sheet.locator("img").nth(1);
  await expect(now).toBeAttached({ timeout: 15_000 });
  await expect(next).toBeAttached();

  // The two read as distinct markers: a wide highlight on what is sounding,
  // a short line on what comes next, so they are never the same shape.
  const nowBox = await now.boundingBox();
  const nextBox = await next.boundingBox();
  expect(nowBox?.width ?? 0).toBeGreaterThan(nextBox?.width ?? 0);
  expect(nextBox?.x ?? 0).toBeGreaterThan(nowBox?.x ?? 0);

  const startLeft = await now.evaluate((node) => node.style.left);

  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect
    .poll(async () => now.evaluate((node) => node.style.left), {
      timeout: 20_000,
    })
    .not.toBe(startLeft);

  // The next cursor keeps leading rather than falling in step with it.
  const nowLeft = await now.evaluate((node) => node.style.left);
  const nextLeft = await next.evaluate((node) => node.style.left);
  expect(nowLeft).not.toBe(nextLeft);
});

test("the notation view follows playback with a smooth, pausable scroll", async ({
  page,
}) => {
  await serveFixture(page);
  // Narrow enough that eight bars of two-track notation wraps across more
  // systems than a screen's worth, so following actually has to scroll.
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto(`/watch?${playerQuery()}`);
  await expect(page.locator("canvas")).toBeVisible();

  await page.getByRole("button", { name: "View" }).click();
  await page.getByRole("button", { name: "Sheet only", exact: true }).click();
  const scroller = page.getByTestId("sheet-scroll");
  await expect
    .poll(async () => scroller.locator("svg path").count(), {
      timeout: 15_000,
    })
    .toBeGreaterThan(20);

  const readTop = (): Promise<number> =>
    scroller.evaluate((node) => node.scrollTop);

  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(readTop, { timeout: 15_000 }).toBeGreaterThan(0);
  await page.screenshot({ path: "/tmp/sheet-follow.png" });

  // Scrolling by hand yields: the position the listener chose has to hold
  // for a while rather than being immediately overridden.
  await scroller.evaluate((node) => {
    node.scrollTop = 0;
  });
  await page.waitForTimeout(700);
  expect(await readTop()).toBeLessThan(30);

  // Once the pause window elapses, following resumes on its own.
  await expect.poll(readTop, { timeout: 6_000 }).toBeGreaterThan(30);
});

test("the vertical progress rail reflects and drives playback position", async ({
  page,
}) => {
  await serveFixture(page);
  await page.goto(`/watch?${playerQuery()}`);
  await expect(page.locator("canvas")).toBeVisible();
  await openHalf(page);

  const rail = page.getByRole("slider", { name: "Notation position" });
  await expect(rail).toBeVisible();
  expect(await rail.inputValue()).toBe("0");

  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect
    .poll(async () => Number(await rail.inputValue()), { timeout: 10_000 })
    .toBeGreaterThan(0.4);

  // Dragging near the far end of the rail seeks there: a click near its
  // bottom (the rail reads top to bottom, like the page it stands beside)
  // jumps position far past where playback had otherwise reached.
  const box = await rail.boundingBox();
  expect(box).not.toBeNull();
  if (box !== null) {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height - 4);
  }
  await expect
    .poll(async () => Number(await rail.inputValue()), { timeout: 5_000 })
    .toBeGreaterThan(5);
});

test("inverting the notation colours flips to a paper look and survives a reload", async ({
  page,
}) => {
  await serveFixture(page);
  await page.goto(`/watch?${playerQuery()}`);
  await expect(page.locator("canvas")).toBeVisible();
  await openHalf(page);

  const scroller = page.getByTestId("sheet-scroll");
  await expect
    .poll(async () => scroller.locator("svg path").count(), {
      timeout: 15_000,
    })
    .toBeGreaterThan(20);
  // A staff line or barline is drawn with a stroke and no fill; a notehead
  // is the reverse, so this is the shortest selector that lands on ink.
  const notePath = scroller.locator('svg path[fill^="#"]').first();
  const readBackground = (): Promise<string> =>
    scroller.evaluate((node) => getComputedStyle(node).backgroundColor);
  const readInk = (): Promise<string> =>
    notePath.evaluate((node) => getComputedStyle(node).fill);

  const darkBackground = await readBackground();
  const darkInk = await readInk();
  await page.screenshot({ path: "/tmp/sheet-dark.png" });

  await page.getByRole("button", { name: "Invert notation colours" }).click();
  await expect.poll(readBackground).not.toBe(darkBackground);
  await expect.poll(readInk).not.toBe(darkInk);
  await page.screenshot({ path: "/tmp/sheet-light.png" });

  await settingStored(page, "sheetTheme", "light");
  await page.reload();
  await expect(page.locator("canvas")).toBeVisible();
  await openHalf(page);
  const scrollerAfterReload = page.getByTestId("sheet-scroll");
  await expect
    .poll(async () =>
      scrollerAfterReload.evaluate(
        (node) => getComputedStyle(node).backgroundColor,
      ),
    )
    .not.toBe(darkBackground);
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

  // Notation reads across the page and the notes fall down it, so the two are
  // stacked and each keeps the whole width rather than halving it.
  const above = await sheet.boundingBox();
  const below = await page
    .getByRole("img", { name: /Piano roll/ })
    .boundingBox();
  expect(above?.y ?? 0).toBeLessThan(below?.y ?? 0);
  expect(above?.width ?? 0).toBeCloseTo(below?.width ?? 0, 0);

  // The popover stays open after picking Split, so Sheet only is already
  // reachable.
  await page.getByRole("button", { name: "View" }).click();
  await page.getByRole("button", { name: "Sheet only", exact: true }).click();
  await expect(sheet).toBeVisible();
  await expect
    .poll(async () => sheet.locator("svg path").count())
    .toBeGreaterThan(20);
  await page.keyboard.press("Escape");
  await page.screenshot({ path: "/tmp/sheet-full.png" });
});

test("the notation view works on a phone-width screen", async ({ page }) => {
  await serveFixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/watch?${playerQuery()}`);
  await expect(page.locator("canvas")).toBeVisible();

  await openHalf(page);
  const sheet = page.getByTestId("sheet-view");
  await expect(sheet).toBeVisible();
  await expect
    .poll(async () => sheet.locator("svg path").count(), { timeout: 15_000 })
    .toBeGreaterThan(20);

  const box = await sheet.boundingBox();
  expect(box?.width ?? 0).toBeLessThanOrEqual(390);
  await expect(
    page.getByRole("slider", { name: "Notation position" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Invert notation colours" }),
  ).toBeVisible();
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
