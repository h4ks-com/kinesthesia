import { expect, test } from "@playwright/test";
import { playerQuery, serveFixture, songName } from "./fixture";

test("the song info panel opens from the menu and shows real analysis", async ({
  page,
}) => {
  await serveFixture(page);
  await page.goto(`/watch?${playerQuery()}`);
  await expect(page.locator("canvas")).toBeVisible();

  await page.getByRole("button", { name: "This song" }).click();
  await page.getByRole("button", { name: "Song info" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(songName)).toBeVisible();

  // No tempo or meter is written into the fixture, so both read as assumed.
  await expect(dialog.getByText("120 bpm")).toBeVisible();
  await expect(dialog.getByText("4/4")).toBeVisible();
  await expect(dialog.getByText("assumed")).toHaveCount(2);

  // Two tracks: the held chord line and the walking melody.
  await expect(
    dialog.getByRole("heading", { name: "Tracks · 2" }),
  ).toBeVisible();

  // The chord track holds C3, E3 and G3 across every bar, a real progression
  // rather than the empty state.
  await expect(dialog.getByText("No chords detected.")).toHaveCount(0);

  // The timeline draws one coloured segment per chord change, and every one
  // of them carries its name and time as a hover tip.
  const segments = dialog.locator('[aria-hidden="true"] [data-tip]');
  await expect(segments.first()).toBeVisible();
  expect(await segments.count()).toBeGreaterThan(0);

  // The whole progression is also read out as an accessible list, so a
  // screen reader user gets it without hovering anything.
  const readout = dialog.locator("ol li");
  expect(await readout.count()).toBeGreaterThan(0);
  await expect(readout.first()).toHaveText(/\d+:\d{2} to \d+:\d{2}/);

  await page.screenshot({ path: "/tmp/info-panel.png" });

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("the chord timeline fits a phone as well as a desktop panel", async ({
  page,
}) => {
  await serveFixture(page);
  await page.goto(`/watch?${playerQuery()}`);
  await expect(page.locator("canvas")).toBeVisible();

  await page.getByRole("button", { name: "This song" }).click();
  await page.getByRole("button", { name: "Song info" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.locator('[aria-hidden="true"] [data-tip]').first(),
  ).toBeVisible();
  await dialog.screenshot({ path: "/tmp/chords-wide.png" });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    dialog.locator('[aria-hidden="true"] [data-tip]').first(),
  ).toBeVisible();
  await dialog.screenshot({ path: "/tmp/chords-phone.png" });
});
