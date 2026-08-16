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

// Replaces "the current and next cursors move as playback advances, one
// onset apart": that test pinned the old stepping design, where an index
// counted onsets and a mismatch between the index and the engraved score
// desynced silently. The new design has no index to desync: a highlight is
// drawn for whichever source notes are actually sounding at the read
// position, found by id. What is worth proving now is that identity, not a
// step count: nothing highlighted before the music starts, something
// highlighted once it does, and nothing left highlighted once the score's
// own last note has stopped sounding, which is also the fix for the score
// not ending when the music does.
test("the highlight follows which notes are actually sounding, by identity", async ({
  page,
}) => {
  await serveFixture(page);
  await page.goto(`/watch?${playerQuery()}`);
  await expect(page.locator("canvas")).toBeVisible();

  await openHalf(page);
  const sheet = page.getByTestId("sheet-view");
  await expect
    .poll(async () => sheet.locator("svg path").count(), { timeout: 15_000 })
    .toBeGreaterThan(20);

  const nowMarks = sheet.locator('[data-testid="sheet-mark-now"]:visible');
  const nextMarks = sheet.locator('[data-testid="sheet-mark-next"]:visible');
  const seek = page.getByRole("slider", { name: "Song position" });

  // Before the runway's first note, nothing sounds, so nothing reads as
  // sounding; what comes next still does.
  await seek.fill("0");
  await expect.poll(() => nowMarks.count()).toBe(0);
  await expect.poll(() => nextMarks.count()).toBeGreaterThan(0);

  // The two read as distinct markers: a wide highlight on what is sounding,
  // a narrow bar on what comes next, so they are never the same shape.
  const nextBox = await nextMarks.first().boundingBox();
  expect(nextBox?.height ?? 0).toBeGreaterThan(40);

  // Well inside the fixture's first notes (the runway shifts the whole file
  // 2.5s forward), something is now sounding.
  await seek.fill("2.6");
  await expect.poll(() => nowMarks.count()).toBeGreaterThan(0);
  const nowBox = await nowMarks.first().boundingBox();
  expect(nowBox?.width ?? 0).toBeGreaterThan(nextBox?.width ?? 0);
  expect(nowBox?.height ?? 0).toBeCloseTo(nextBox?.height ?? 0, 0);

  // Past the last note's own sound, the score has nothing left to mark: it
  // ends when the music does rather than running on with an empty highlight.
  const max = await seek.getAttribute("max");
  await seek.fill(String(max));
  await expect.poll(() => nowMarks.count()).toBe(0);
  await expect.poll(() => nextMarks.count()).toBe(0);
});

test("the notation belongs to the music while it plays and to the reader once it stops", async ({
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

  // Playing, a hand on the notation is refused outright, so the follow never
  // has anything to fight.
  await expect(scroller).toHaveCSS("pointer-events", "none");
  const box = await scroller.boundingBox();
  expect(box).not.toBeNull();
  if (box !== null) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 600);
  }
  await page.waitForTimeout(400);
  const followed = await readTop();

  await page.getByRole("button", { name: "Pause", exact: true }).click();
  // Stopping keeps the page where the music left it rather than throwing the
  // reader back to the first bar.
  await expect(scroller).not.toHaveCSS("pointer-events", "none");
  await page.waitForTimeout(600);
  expect(Math.abs((await readTop()) - followed)).toBeLessThan(80);

  // Stopped, a scroll by hand stays where it was put. Asked for beyond the end
  // of the score the browser clamps it, so the reading, not the request, is
  // what the wait is measured against.
  const chosen = await scroller.evaluate((node, to: number) => {
    node.scrollTop = to;
    return node.scrollTop;
  }, followed + 400);
  expect(chosen).toBeGreaterThan(followed);
  await page.waitForTimeout(3_000);
  expect(Math.abs((await readTop()) - chosen)).toBeLessThan(80);

  // Asking for a bar in the same breath as moving the page by hand still takes
  // the reader there, rather than leaving them on a system with no marker on
  // it: the two windows overlap, and the scroll must not swallow the seek.
  await scroller.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await page.getByRole("slider", { name: "Song position" }).fill("0");
  await expect.poll(readTop, { timeout: 6_000 }).toBeLessThan(100);
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

type Box = { x: number; y: number; width: number; height: number };

function boxesIntersect(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

async function requireBox(
  locator: import("@playwright/test").Locator,
): Promise<Box> {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error("element has no layout box");
  }
  return box;
}

test("the focus exit and the invert button stay clear of each other in focus mode", async ({
  page,
}) => {
  await serveFixture(page);
  await page.goto(`/watch?${playerQuery()}`);
  await expect(page.locator("canvas")).toBeVisible();

  await openHalf(page);
  await page.getByRole("button", { name: "Focus mode" }).click();

  const exit = page.getByRole("button", { name: "Leave focus" });
  const invert = page.getByRole("button", { name: "Invert notation colours" });
  await expect(exit).toBeVisible();
  await expect(invert).toBeVisible();

  expect(boxesIntersect(await requireBox(exit), await requireBox(invert))).toBe(
    false,
  );

  await page.setViewportSize({ width: 390, height: 844 });
  expect(boxesIntersect(await requireBox(exit), await requireBox(invert))).toBe(
    false,
  );
});
