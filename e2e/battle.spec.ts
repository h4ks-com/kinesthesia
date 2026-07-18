import { expect, test } from "@playwright/test";
import { playerQuery, serveFixture } from "./fixture";

test("a battle is set up and previewed before anyone is invited", async ({
  page,
}) => {
  await serveFixture(page);
  await page.goto(`/battle?${playerQuery()}`);

  // The song is playable straight away, so the host can try the part first.
  await expect(page.locator("canvas").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Simplify" })).toBeVisible();

  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByLabel("Playback speed")).toBeVisible();
  await page.keyboard.press("Escape");

  await expect(
    page.getByRole("button", { name: "Invite a player" }),
  ).toBeVisible();
});

test("the room stores the difficulty and the link stays short", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await serveFixture(page);
  let posted: { simplified?: boolean } = {};
  await page.route("**/api/battle/rooms", async (route) => {
    posted = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ code: "ABCDE" }),
    });
  });

  await page.goto(`/battle?${playerQuery()}`);
  await expect(page.locator("canvas").first()).toBeVisible();
  await page.getByRole("button", { name: "Simplify" }).click();
  await page.getByRole("button", { name: "Invite a player" }).click();

  const invite = page.getByRole("button", { name: "Copy the invite link" });
  await expect(invite).toBeVisible({ timeout: 20_000 });

  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toContain("join=ABCDE");
  expect(link).not.toContain("url=");
  expect(posted.simplified).toBe(true);
});

test("opening an invite link joins without typing a code", async ({ page }) => {
  await serveFixture(page);
  await page.route("**/api/battle/rooms/ABCDE", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        peerId: "peer-does-not-exist",
        url: "https://example.test/fixture.mid",
        name: "Fixture Song",
        source: "bitmidi",
        tracks: [0],
        speed: 1,
        simplified: true,
        melodyRate: 4,
      }),
    }),
  );

  await page.goto("/battle?join=ABCDE");
  await expect(page.getByText("Joining the match")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Invite a player" }),
  ).toHaveCount(0);
});

test("an expired invite says so", async ({ page }) => {
  await serveFixture(page);
  await page.route("**/api/battle/rooms/ZZZZZ", (route) =>
    route.fulfill({ status: 404, body: "{}" }),
  );

  await page.goto(`/battle?${playerQuery()}&join=ZZZZZ`);
  await expect(page.getByText("That invite has expired")).toBeVisible();
});

test("confirming the invite freezes the settings", async ({ page }) => {
  await serveFixture(page);
  await page.route("**/api/battle/rooms", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ code: "ABCDE" }),
    }),
  );

  await page.goto(`/battle?${playerQuery()}`);
  await expect(page.locator("canvas").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Simplify" })).toBeVisible();

  await page.getByRole("button", { name: "Invite a player" }).click();
  await expect(
    page.getByRole("button", { name: "Copy the invite link" }),
  ).toBeVisible({ timeout: 20_000 });

  // The room already holds these settings, so they cannot move underneath it.
  await expect(page.getByRole("button", { name: "Simplify" })).toHaveCount(0);
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByLabel("Playback speed")).toHaveCount(0);
});

test("claiming a track is frozen once the invite is out", async ({ page }) => {
  await serveFixture(page);
  await page.route("**/api/battle/rooms", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ code: "ABCDE" }),
    }),
  );

  await page.goto(`/battle?${playerQuery()}`);
  await expect(page.locator("canvas").first()).toBeVisible();
  await page.getByRole("button", { name: "Tracks" }).click();
  await expect(
    page.getByRole("button", { name: /Play .* yourself/ }).first(),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Invite a player" }).click();
  await expect(
    page.getByRole("button", { name: "Copy the invite link" }),
  ).toBeVisible({ timeout: 20_000 });

  // The room stored which tracks the host plays, so they cannot swap now.
  await page.getByRole("button", { name: "Tracks" }).click();
  await expect(
    page.getByRole("button", { name: /Play .* yourself/ }),
  ).toHaveCount(0);
});

test("battle is split with an opponent side from the start", async ({
  page,
}) => {
  await serveFixture(page);
  await page.goto(`/battle?${playerQuery()}`);

  // Two rolls before anyone joins: yours and the opponent's, which waits.
  await expect(page.locator("canvas")).toHaveCount(2);
  await expect(page.getByText("Opponent")).toBeVisible();
  await expect(page.getByText("waiting for a player")).toBeVisible();
});
