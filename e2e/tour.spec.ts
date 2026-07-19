import { expect, type Page, test } from "@playwright/test";
import { playerQuery, serveFixture, songName, songUrl } from "./fixture";

const skip = (page: Page) =>
  page.getByRole("button", { name: "Skip tutorial" });

async function walkToEnd(page: Page): Promise<string[]> {
  const seen: string[] = [];
  for (let guard = 0; guard < 12; guard += 1) {
    const title = page.locator("#walkthrough-title");
    if ((await title.count()) === 0) {
      break;
    }
    seen.push((await title.textContent()) ?? "");
    await page.waitForTimeout(250);
    await page.getByRole("button", { name: /^(Next|Done)$/ }).click();
  }
  return seen;
}

test("the walkthrough runs on a first visit, then stays gone", async ({
  page,
}) => {
  await serveFixture(page, { tour: true });
  await page.goto(`/watch?${playerQuery()}`);
  await expect(skip(page)).toBeVisible({ timeout: 15_000 });

  const seen = await walkToEnd(page);
  expect(seen[0]).toBe("Tracks");
  expect(seen).toContain("Focus");
  await expect(page.locator("#walkthrough-title")).toHaveCount(0);

  // A returning visitor is not shown it again.
  await page.reload();
  await expect(page.locator("canvas")).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(page.locator("#walkthrough-title")).toHaveCount(0);
});

test("skipping remembers it, and the help button replays it", async ({
  page,
}) => {
  await serveFixture(page, { tour: true });
  await page.goto(`/learn?${playerQuery()}`);
  await expect(skip(page)).toBeVisible({ timeout: 15_000 });
  await skip(page).click();
  await expect(page.locator("#walkthrough-title")).toHaveCount(0);

  await page.reload();
  await expect(page.locator("canvas")).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(page.locator("#walkthrough-title")).toHaveCount(0);

  await page.getByRole("button", { name: "Tutorial", exact: true }).click();
  await expect(page.locator("#walkthrough-title")).toHaveText("Your part");
});

test("a match joiner is not walked through the host's setup", async ({
  page,
}) => {
  await serveFixture(page, { tour: true });
  await page.route("**/api/multiplayer/rooms/ABCDE", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        peerId: "peer-does-not-exist",
        url: songUrl,
        name: songName,
        source: "bitmidi",
        tracks: [0],
        speed: 1,
        simplified: false,
        melodyRate: 8,
        transpose: 0,
        coop: false,
      }),
    }),
  );

  await page.goto("/multiplayer?join=ABCDE");
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1200);
  await expect(skip(page)).toHaveCount(0);
});

test("the tour opens the tracks and points inside them", async ({ page }) => {
  await serveFixture(page, { tour: true });
  await page.goto(`/learn?${playerQuery()}`);
  await expect(skip(page)).toBeVisible({ timeout: 15_000 });

  // The first tracks step opens the list, revealing its rows.
  await expect(page.locator("#walkthrough-title")).toHaveText("Your part");
  await expect(
    page.getByRole("button", { name: /Play .* yourself/ }).first(),
  ).toBeVisible();

  const advanceTo = async (title: string) => {
    const heading = page.locator("#walkthrough-title");
    for (let guard = 0; guard < 8; guard += 1) {
      if ((await heading.textContent()) === title) {
        return;
      }
      await page.getByRole("button", { name: /^(Next|Done)$/ }).click();
      await page.waitForTimeout(250);
    }
    throw new Error(`never reached ${title}`);
  };

  // The sound step points at a track's instrument control, inside the list.
  await advanceTo("Change the sound");
  await expect(
    page.getByRole("button", { name: /Change how .* sounds/ }).first(),
  ).toBeVisible();

  // Moving past the tracks steps puts the list away again.
  await advanceTo("Make it easier");
  await expect(
    page.getByRole("button", { name: /Change how .* sounds/ }),
  ).toHaveCount(0);
});

test("on a phone the walkthrough fits and never covers what it points at", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await serveFixture(page, { tour: true });
  await page.goto(`/learn?${playerQuery()}`);
  await expect(skip(page)).toBeVisible({ timeout: 15_000 });
  // The replay button stays reachable on a phone.
  await expect(
    page.getByRole("button", { name: "Tutorial", exact: true }),
  ).toBeVisible();

  for (let guard = 0; guard < 12; guard += 1) {
    if ((await page.locator("#walkthrough-title").count()) === 0) {
      break;
    }
    // The spotlight glides between steps, so read positions once it settles.
    await page.waitForTimeout(300);
    const clear = await page.evaluate(() => {
      const dlg = document
        .querySelector('[role="dialog"]')
        ?.getBoundingClientRect();
      const spot = document
        .querySelector('.z-\\[70\\] > div[aria-hidden="true"]')
        ?.getBoundingClientRect();
      if (dlg === undefined || spot === undefined) {
        return false;
      }
      const onScreen =
        dlg.top >= -1 &&
        dlg.bottom <= window.innerHeight + 1 &&
        dlg.left >= -1 &&
        dlg.right <= window.innerWidth + 1;
      const apart =
        dlg.right < spot.left ||
        dlg.left > spot.right ||
        dlg.bottom < spot.top ||
        dlg.top > spot.bottom;
      return onScreen && apart;
    });
    expect(clear).toBe(true);
    await page.getByRole("button", { name: /^(Next|Done)$/ }).click();
  }
});
