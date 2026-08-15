import { expect, test } from "@playwright/test";
import { brightNotePixels, playerQuery, serveFixture } from "./fixture";

test("choosing a hand narrows the owed part and changes what is drawn bright", async ({
  page,
}) => {
  await serveFixture(page);
  // Track 0 is the chord line: three simultaneous notes a bar, so a hand
  // choice has real polyphony to split rather than one note to keep whole.
  await page.goto(`/learn?${playerQuery()}&tracks=0`);
  await expect(page.locator("canvas")).toBeVisible();

  await expect.poll(async () => brightNotePixels(page)).toBeGreaterThan(1000);
  const both = await brightNotePixels(page);

  const chooseHand = async (label: string): Promise<void> => {
    await page.getByRole("button", { name: /^Hand, / }).click();
    await page.getByRole("button", { name: label, exact: true }).click();
  };

  await chooseHand("Left hand");
  await expect(page).toHaveURL(/hand=left/);
  await expect
    .poll(async () => brightNotePixels(page))
    .toBeLessThan(both * 0.9);
  const left = await brightNotePixels(page);

  await chooseHand("Right hand");
  await expect(page).toHaveURL(/hand=right/);
  await expect
    .poll(async () => brightNotePixels(page))
    .toBeLessThan(both * 0.9);
  const right = await brightNotePixels(page);

  // The two hands own different notes, so their share of the roll differs.
  expect(Math.abs(left - right)).toBeGreaterThan(both * 0.05);

  await chooseHand("Both hands");
  await expect(page).toHaveURL(/hand=both/);
  await expect.poll(async () => brightNotePixels(page)).toBeGreaterThan(left);
});

test("a locked side shows the hand chooser disabled rather than missing", async ({
  page,
}) => {
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

  await page.getByRole("button", { name: "Invite a player" }).click();
  await expect(
    page.getByRole("button", { name: "Copy the invite link" }),
  ).toBeVisible({ timeout: 20_000 });

  // A battle mirrors the host's line onto the other side and locks it, so
  // their hand chooser stays put but disabled rather than disappearing.
  const theirs = page.getByRole("region", { name: "Other player" });
  const chooser = theirs.getByRole("button", { name: /^Their hand, / });
  await expect(chooser).toBeVisible();
  await expect(chooser).toBeDisabled();
});
