import { expect, type Page, test } from "@playwright/test";
import { playerQuery, serveFixture, songName, songUrl } from "./fixture";

const skip = (page: Page) =>
  page.getByRole("button", { name: "Skip tutorial" });

/** What keeps a walkthrough from coming back is the note that it was seen, so
 * that note is what a reload waits on rather than a span of time. */
async function marked(
  page: Page,
  mode: "watch" | "learn" | "multiplayer",
): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        (key) => localStorage.getItem(`kinesthesia:tour:${key}`),
        mode,
      ),
    )
    .not.toBeNull();
}

/** The step being shown, or null once the walkthrough has finished. */
async function step(page: Page): Promise<string | null> {
  const title = page.locator("#walkthrough-title");
  return (await title.count()) === 0 ? null : await title.textContent();
}

/** Waits for the walkthrough to leave a step, so a reading is never taken of
 * the one that was already on screen when Next was clicked. */
async function leftStep(page: Page, from: string | null): Promise<void> {
  await expect.poll(async () => step(page), { timeout: 15_000 }).not.toBe(from);
}

async function walkToEnd(page: Page): Promise<string[]> {
  const seen: string[] = [];
  for (let guard = 0; guard < 12; guard += 1) {
    const showing = await step(page);
    if (showing === null) {
      break;
    }
    seen.push(showing);
    await page.getByRole("button", { name: /^(Next|Done)$/ }).click();
    await leftStep(page, showing);
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
  await marked(page, "watch");
  await page.reload();
  await expect(page.locator("canvas")).toBeVisible();
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

  await marked(page, "learn");
  await page.reload();
  await expect(page.locator("canvas")).toBeVisible();
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

  const advanceTo = async (title: string): Promise<void> => {
    for (let guard = 0; guard < 8; guard += 1) {
      const showing = await step(page);
      if (showing === title) {
        return;
      }
      await page.getByRole("button", { name: /^(Next|Done)$/ }).click();
      await leftStep(page, showing);
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
    const showing = await step(page);
    if (showing === null) {
      break;
    }
    // The spotlight glides between steps, so this waits for it to land rather
    // than guessing how long the glide takes on this machine.
    const clear = async (): Promise<boolean> =>
      page.evaluate(() => {
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
    await expect.poll(clear, { timeout: 15_000 }).toBe(true);
    await page.getByRole("button", { name: /^(Next|Done)$/ }).click();
    await leftStep(page, showing);
  }
});
