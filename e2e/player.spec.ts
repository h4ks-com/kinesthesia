import { expect, test } from "@playwright/test";
import { playerQuery, serveFixture, songName } from "./fixture";

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
  await page.getByRole("button", { name: "Search" }).click();

  await expect(page.getByText("A Test Song")).toBeVisible();
  await expect(page.getByText("4,321 plays")).toBeVisible();
  await expect(page.getByRole("link", { name: "Watch" })).toBeVisible();
});

test("watch renders the song and the clock moves", async ({ page }) => {
  await serveFixture(page);
  await page.goto(`/watch?${playerQuery()}`);

  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.getByText(songName)).toBeVisible();

  await page.getByRole("button", { name: "Play" }).click();
  await expect
    .poll(async () => page.locator("footer span").first().innerText(), {
      timeout: 15_000,
    })
    .not.toBe("0:00 / 0:08");
});

test("play mode stops and waits for the player", async ({ page }) => {
  await serveFixture(page);
  await page.goto(`/play?${playerQuery()}`);

  await expect(page.locator("canvas")).toBeVisible();
  await page.getByRole("button", { name: "Play" }).click();

  await expect(page.getByText("Waiting for your note")).toBeVisible({
    timeout: 15_000,
  });
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
