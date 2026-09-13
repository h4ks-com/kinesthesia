import { expect, type Page, test } from "@playwright/test";
import type { PlayerMode } from "@/lib/player-url";
import { tourFor } from "@/lib/tour/steps";
import { playerQuery, serveFixture, songName, songUrl } from "./fixture";

const skip = (page: Page) =>
  page.getByRole("button", { name: "Skip tutorial", exact: true });

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

type Box = { top: number; left: number; right: number; bottom: number };

type TourGeometry = {
  dlg: Box;
  spot: Box;
  anchorBox: Box | null;
  footerRows: readonly { top: number; bottom: number }[];
};

/** The dialog and the spotlight it floats beside, read off the DOM. Null while
 * either has yet to render. */
async function tourGeometry(
  page: Page,
  anchor: string,
): Promise<TourGeometry | null> {
  return page.evaluate((anchorAttr) => {
    const dlg = document
      .querySelector('[role="dialog"]')
      ?.getBoundingClientRect();
    const spot = document
      .querySelector('.z-\\[70\\] > div[aria-hidden="true"]')
      ?.getBoundingClientRect();
    const footer = document.querySelector('[role="dialog"] > div:last-child');
    if (dlg === undefined || spot === undefined || footer === null) {
      return null;
    }
    const footerRows = Array.from(footer.children).map((child) => {
      const box = child.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom };
    });
    // Read in the same pass as the spotlight, so a step whose anchor is still
    // animating into place (a popover opening, a list reflowing) cannot be
    // caught between two separately timed reads.
    const anchorEl = document.querySelector(`[data-tour="${anchorAttr}"]`);
    const anchorRect = anchorEl?.getBoundingClientRect() ?? null;
    return {
      dlg: {
        top: dlg.top,
        left: dlg.left,
        right: dlg.right,
        bottom: dlg.bottom,
      },
      spot: {
        top: spot.top,
        left: spot.left,
        right: spot.right,
        bottom: spot.bottom,
      },
      anchorBox: anchorRect
        ? {
            top: anchorRect.top,
            left: anchorRect.left,
            right: anchorRect.right,
            bottom: anchorRect.bottom,
          }
        : null,
      footerRows,
    };
  }, anchor);
}

const modes: readonly PlayerMode[] = ["watch", "learn", "multiplayer"];

/** Two real phones the reports were taken on: one where the dialog sat far
 * from its target, one where it sat on top of it. */
const phoneSizes = [
  { width: 390, height: 844 },
  { width: 360, height: 640 },
] as const;

for (const size of phoneSizes) {
  for (const mode of modes) {
    test(`on a ${size.width}x${size.height} phone the ${mode} walkthrough fits, never covers what it points at, and keeps its footer on one line`, async ({
      page,
    }) => {
      await page.setViewportSize(size);
      await serveFixture(page, { tour: true });
      await page.goto(`/${mode}?${playerQuery()}`);
      await expect(skip(page)).toBeVisible({ timeout: 15_000 });
      // The replay button stays reachable on a phone.
      await expect(
        page.getByRole("button", { name: "Tutorial", exact: true }),
      ).toBeVisible();

      for (const expected of tourFor(mode)) {
        await expect(page.locator("#walkthrough-title")).toHaveText(
          expected.title,
        );

        // The spotlight glides between steps and the dialog measures itself a
        // frame later, so this waits for both to land on the real control
        // rather than guessing how long that takes on this machine. Reading
        // the anchor in the same pass as the spotlight keeps a step whose
        // target is still animating into place from being caught between two
        // separately timed reads.
        const settled = async (): Promise<boolean> => {
          const geometry = await tourGeometry(page, expected.anchor);
          if (geometry === null || geometry.anchorBox === null) {
            return false;
          }
          const { dlg, spot, anchorBox } = geometry;
          const onScreen =
            dlg.top >= -1 &&
            dlg.bottom <= size.height + 1 &&
            dlg.left >= -1 &&
            dlg.right <= size.width + 1;
          const apart =
            dlg.right < spot.left ||
            dlg.left > spot.right ||
            dlg.bottom < spot.top ||
            dlg.top > spot.bottom;
          const onTarget =
            anchorBox.left < spot.right &&
            anchorBox.right > spot.left &&
            anchorBox.top < spot.bottom &&
            anchorBox.bottom > spot.top;
          return onScreen && apart && onTarget;
        };
        await expect.poll(settled, { timeout: 15_000 }).toBe(true);

        const geometry = await tourGeometry(page, expected.anchor);
        if (geometry !== null) {
          // The counter, the skip link and the step buttons never wrap: every
          // child of the footer row shares some vertical band with the rest,
          // which a taller button still does even though it centres on a
          // slightly different top than a bare line of text.
          const { footerRows } = geometry;
          const bandTop = Math.max(...footerRows.map((row) => row.top));
          const bandBottom = Math.min(...footerRows.map((row) => row.bottom));
          expect(bandTop).toBeLessThan(bandBottom);
        }

        const showing = await step(page);
        await page.getByRole("button", { name: /^(Next|Done)$/ }).click();
        await leftStep(page, showing);
      }
    });
  }
}

/** Walks every step a mode's tour defines and checks the control it names is
 * really on the page, so a renamed or removed control fails this test instead
 * of shipping a tour that points at nothing. */
for (const mode of modes) {
  test(`every step of the ${mode} tour points at a real, visible control`, async ({
    page,
  }) => {
    await serveFixture(page, { tour: true });
    await page.goto(`/${mode}?${playerQuery()}`);
    await expect(skip(page)).toBeVisible({ timeout: 15_000 });

    for (const expected of tourFor(mode)) {
      await expect(page.locator("#walkthrough-title")).toHaveText(
        expected.title,
      );
      await expect(
        page.locator(`[data-tour="${expected.anchor}"]`).first(),
      ).toBeVisible();
      const showing = await step(page);
      await page.getByRole("button", { name: /^(Next|Done)$/ }).click();
      await leftStep(page, showing);
    }
    await expect(page.locator("#walkthrough-title")).toHaveCount(0);
  });
}
