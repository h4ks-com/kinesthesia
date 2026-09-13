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

  // One segment per chord change, each naming its own chord and span, so the
  // progression is readable without a pointer to hover it with.
  const segments = dialog.getByRole("option");
  await expect(segments.first()).toBeVisible();
  expect(await segments.count()).toBeGreaterThan(0);
  await expect(segments.first()).toHaveAttribute(
    "aria-label",
    /\d+:\d{2} to \d+:\d{2}/,
  );

  // Arrowing through them reads one out where the bar has no room to print it.
  await dialog.getByRole("listbox", { name: "Chord progression" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(dialog.locator('[aria-live="polite"]')).toContainText(" to ");

  await page.screenshot({ path: "/tmp/info-panel.png" });

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("clicking empty header space leaves the song menu closed", async ({
  page,
}) => {
  await serveFixture(page);
  await page.goto(`/watch?${playerQuery()}`);
  await expect(page.locator("canvas")).toBeVisible();

  const title = page.getByRole("button", { name: "This song" });
  const view = page.getByRole("button", { name: "View" });
  const titleBox = await title.boundingBox();
  const viewBox = await view.boundingBox();
  if (titleBox === null || viewBox === null) {
    throw new Error("header controls not found");
  }

  const emptySpaceX = (titleBox.x + titleBox.width + viewBox.x) / 2;
  await page.mouse.click(emptySpaceX, titleBox.y + titleBox.height / 2);

  await expect(page.getByRole("button", { name: "Song info" })).toHaveCount(0);
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
  await expect(dialog.locator('[role="option"]').first()).toBeVisible();
  await dialog.screenshot({ path: "/tmp/chords-wide.png" });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog.locator('[role="option"]').first()).toBeVisible();
  await dialog.screenshot({ path: "/tmp/chords-phone.png" });
});
