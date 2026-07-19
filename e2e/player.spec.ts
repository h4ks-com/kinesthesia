import { expect, test } from "@playwright/test";
import {
  brightNotePixels,
  isPureWhite,
  keyRowFromBottom,
  litKeyCentre,
  playerQuery,
  serveFixture,
  songName,
} from "./fixture";

test("search lists results and links into the player", async ({ page }) => {
  await page.route("**/api/midi/search**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [
          {
            id: "1",
            source: "bitmidi",
            name: "A Test Song",
            plays: 4321,
            downloadUrl: "https://example.test/fixture.mid",
            sourceUrl: "https://example.test/song",
            playUrl: `/watch?${playerQuery()}`,
          },
        ],
      }),
    }),
  );

  await page.goto("/");
  await page.getByLabel("Search for a song").fill("test");

  await expect(page.getByText("A Test Song")).toBeVisible();
  await expect(page.getByText("4,321 plays")).toBeVisible();
  await expect(page.getByRole("link", { name: "Watch" })).toBeVisible();
});

test("watch renders the song and the clock moves", async ({ page }) => {
  await serveFixture(page);
  await page.goto(`/watch?${playerQuery()}`);

  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.getByText(songName)).toBeVisible();

  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect
    .poll(async () => page.locator("footer span").first().innerText(), {
      timeout: 15_000,
    })
    .not.toBe("0:00 / 0:08");
});

test("learn mode stops and waits for the player", async ({ page }) => {
  await serveFixture(page);
  await page.goto(`/learn?${playerQuery()}`);

  await expect(page.locator("canvas")).toBeVisible();
  await page.getByRole("button", { name: "Play", exact: true }).click();

  await expect(page.getByText("waiting for you")).toBeVisible({
    timeout: 15_000,
  });
});

test("striking a key the song already lit still shows the hit", async ({
  page,
}) => {
  await serveFixture(page);
  await page.goto(`/learn?${playerQuery()}`);
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();

  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByText("waiting for you")).toBeVisible({
    timeout: 15_000,
  });

  const box = await canvas.boundingBox();
  const keyRow = (box?.height ?? 0) - keyRowFromBottom;
  const lit = await litKeyCentre(page);
  expect(lit).not.toBeNull();

  const x = lit ?? 0;
  expect(await isPureWhite(page, x)).toBe(false);

  await page.mouse.move((box?.x ?? 0) + x, (box?.y ?? 0) + keyRow);
  await page.mouse.down();
  await expect.poll(async () => isPureWhite(page, x)).toBe(true);

  await page.mouse.up();
  await expect.poll(async () => isPureWhite(page, x)).toBe(false);
});

test("a link without a song explains itself", async ({ page }) => {
  await page.goto("/watch");
  await expect(
    page.getByText("That link has no playable song on it."),
  ).toBeVisible();
});

test("a javascript url is refused", async ({ page }) => {
  await page.goto("/watch?url=javascript:alert(1)&name=x");
  await expect(
    page.getByText("That link has no playable song on it."),
  ).toBeVisible();
});

test("simplify reduces the part and ghosts the rest", async ({ page }) => {
  await serveFixture(page);
  // Track 0 is the chord line, so there is real polyphony to reduce.
  await page.goto(`/learn?${playerQuery()}&tracks=0`);
  await expect(page.locator("canvas")).toBeVisible();

  // The roll paints on an animation frame, so wait for it to settle before
  // taking the reading everything else is measured against.
  await expect.poll(async () => brightNotePixels(page)).toBeGreaterThan(1000);
  const full = await brightNotePixels(page);

  await page.getByRole("button", { name: "Simplify" }).click();
  await expect(page).toHaveURL(/simple=1/);
  await expect
    .poll(async () => brightNotePixels(page))
    .toBeLessThan(full * 0.9);
});

test("the note speed slider follows the simplify toggle", async ({ page }) => {
  await serveFixture(page);
  await page.goto(`/learn?${playerQuery()}`);
  await expect(page.locator("canvas")).toBeVisible();

  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByLabel("Maximum notes per second")).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Simplify" }).click();
  await page.getByRole("button", { name: "Settings" }).click();
  const rate = page.getByLabel("Maximum notes per second");
  await expect(rate).toBeVisible();
  await rate.fill("3");
  await expect(page).toHaveURL(/rate=3/);
});

test("multiplayer keeps the simplify setting fixed for both players", async ({
  page,
}) => {
  await serveFixture(page);
  await page.goto(`/learn?${playerQuery()}`);
  await page.getByRole("button", { name: "Simplify" }).click();

  const multiplayer = page.getByRole("link", {
    name: "Switch to Multiplayer",
  });
  await expect(multiplayer).toHaveAttribute("href", /simple=1/);
});

test("a song remembers its settings across modes", async ({ page }) => {
  await serveFixture(page);
  await page.goto(`/learn?${playerQuery()}`);
  await expect(page.locator("canvas")).toBeVisible();

  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByLabel("Playback speed").fill("1");
  await expect(page).toHaveURL(/speed=0.5/);
  await page.keyboard.press("Escape");

  await page.goto(`/watch?${playerQuery()}`);
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page).toHaveURL(/speed=0.5/);
});

test("key width is remembered across different songs", async ({ page }) => {
  await serveFixture(page);
  await page.goto(`/learn?${playerQuery()}`);
  await expect(page.locator("canvas")).toBeVisible();

  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByLabel("Piano key width").fill("60");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  await page.goto(
    `/learn?url=${encodeURIComponent("https://example.test/other.mid")}&name=Other`,
  );
  await serveFixture(page);
  await page.goto(`/learn?${playerQuery()}`);
  await expect(page.locator("canvas")).toBeVisible();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByLabel("Piano key width")).toHaveValue("60");
});

test("space plays even when a control was just clicked", async ({ page }) => {
  await serveFixture(page);
  await page.goto(`/learn?${playerQuery()}`);
  await expect(page.locator("canvas")).toBeVisible();

  // Clicking Simplify leaves it focused; space must still start playback and
  // must not toggle Simplify a second time.
  const simplify = page.getByRole("button", { name: "Simplify" });
  await simplify.click();
  await expect(page).toHaveURL(/simple=1/);
  await expect(simplify).toBeFocused();

  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await expect(page).toHaveURL(/simple=1/);
});

test("learn ghosts every track but the one you play, without simplify", async ({
  page,
}) => {
  await serveFixture(page);

  // Watch draws the whole song bright.
  await page.goto(`/watch?${playerQuery()}`);
  await expect(page.locator("canvas")).toBeVisible();
  await expect.poll(async () => brightNotePixels(page)).toBeGreaterThan(1000);
  const whole = await brightNotePixels(page);

  // Learn, claiming one track, lights only that track and ghosts the rest.
  await page.goto(`/learn?${playerQuery()}&tracks=0`);
  await expect(page.locator("canvas")).toBeVisible();
  await expect
    .poll(async () => brightNotePixels(page))
    .toBeLessThan(whole * 0.9);
});
