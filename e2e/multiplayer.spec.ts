import { expect, test } from "@playwright/test";
import { playerQuery, serveFixture } from "./fixture";

test("a match is set up and previewed before anyone is invited", async ({
  page,
}) => {
  await serveFixture(page);
  await page.goto(`/multiplayer?${playerQuery()}`);

  // The song is playable straight away, so the host can try the part first.
  await expect(page.locator("canvas").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Simplify to one note at a time" }),
  ).toBeVisible();

  // One tempo for the whole match, so it sits on the shared timeline.
  await page.getByRole("button", { name: "Speed" }).click();
  await expect(page.getByLabel("Playback speed")).toBeVisible();
  await page.keyboard.press("Escape");

  // Sending the invite is the last step, so it sits at the far end of the
  // shared bar, under the other player's half.
  await expect(
    page.locator("footer").getByRole("button", { name: "Invite a player" }),
  ).toBeVisible();
});

test("the room stores the difficulty and the link stays short", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await serveFixture(page);
  let posted: { simplified?: boolean } = {};
  await page.route("**/api/multiplayer/rooms", async (route) => {
    posted = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ code: "ABCDE" }),
    });
  });

  await page.goto(`/multiplayer?${playerQuery()}`);
  await expect(page.locator("canvas").first()).toBeVisible();
  await page
    .getByRole("button", { name: "Simplify to one note at a time" })
    .click();
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
  await page.route("**/api/multiplayer/rooms/ABCDE", (route) =>
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
        coop: false,
      }),
    }),
  );

  await page.goto("/multiplayer?join=ABCDE");
  await expect(page.getByText("Joining the match")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Invite a player" }),
  ).toHaveCount(0);
});

test("an expired invite says so", async ({ page }) => {
  await serveFixture(page);
  await page.route("**/api/multiplayer/rooms/ZZZZZ", (route) =>
    route.fulfill({ status: 404, body: "{}" }),
  );

  await page.goto(`/multiplayer?${playerQuery()}&join=ZZZZZ`);
  await expect(page.getByText("That invite has expired")).toBeVisible();
});

test("confirming the invite freezes the settings", async ({ page }) => {
  await serveFixture(page);
  await page.route("**/api/multiplayer/rooms", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ code: "ABCDE" }),
    }),
  );

  await page.goto(`/multiplayer?${playerQuery()}`);
  await expect(page.locator("canvas").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Simplify to one note at a time" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Invite a player" }).click();
  await expect(
    page.getByRole("button", { name: "Copy the invite link" }),
  ).toBeVisible({ timeout: 20_000 });

  // The invite ends setup: the part is fixed on both halves and neither side
  // is played again, but the controls stay put so the two still read alike.
  await expect(
    page.getByRole("button", { name: "Simplify to one note at a time" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", {
      name: "Simplify their part to one note at a time",
    }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Battle", exact: true }),
  ).toBeDisabled();
});

test("claiming a track is frozen once the invite is out", async ({ page }) => {
  await serveFixture(page);
  await page.route("**/api/multiplayer/rooms", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ code: "ABCDE" }),
    }),
  );

  await page.goto(`/multiplayer?${playerQuery()}`);
  await expect(page.locator("canvas").first()).toBeVisible();
  await page.getByRole("button", { name: "Tracks" }).first().click();
  await expect(
    page.getByRole("button", { name: /Play .* yourself/ }).first(),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Invite a player" }).click();
  await expect(
    page.getByRole("button", { name: "Copy the invite link" }),
  ).toBeVisible({ timeout: 20_000 });

  // The room stored which tracks the host plays, so they cannot swap now.
  await page.getByRole("button", { name: "Tracks" }).first().click();
  await expect(
    page.getByRole("button", { name: /Play .* yourself/ }),
  ).toHaveCount(0);
});

test("the match is split with an opponent side from the start", async ({
  page,
}) => {
  await serveFixture(page);
  await page.goto(`/multiplayer?${playerQuery()}`);
  const theirs = page.getByRole("region", { name: "Other player" });

  // Two rolls before anyone joins: yours and theirs, with their score beside it.
  await expect(page.locator("canvas")).toHaveCount(2);
  await expect(theirs.getByText("Opponent")).toBeVisible();
  await expect(theirs.getByText(/%\s*·\s*\dx/)).toBeVisible();
});

test("battle locks the other side, co-op opens it up", async ({ page }) => {
  await serveFixture(page);
  await page.goto(`/multiplayer?${playerQuery()}`);
  await expect(page.locator("canvas").first()).toBeVisible();
  const theirs = page.getByRole("region", { name: "Other player" });
  const theirSimplify = theirs.getByRole("button", {
    name: "Simplify their part to one note at a time",
  });

  // Battle means one shared part, so their side is fixed to yours.
  await expect(theirSimplify).toBeDisabled();

  await page.getByRole("button", { name: "Co-op", exact: true }).click();

  // Co-op hands their part over to the host to build.
  await expect(theirSimplify).toBeEnabled();
  await theirs.getByRole("button", { name: "Tracks" }).click();
  await expect(
    page.getByRole("button", { name: /Play .* yourself/ }).first(),
  ).toBeVisible();
});
