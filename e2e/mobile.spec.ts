import { devices, expect, test } from "@playwright/test";
import {
  brightNotePixels,
  isStruckKey,
  keyRowFromBottom,
  playerQuery,
  serveFixture,
  whiteKeyCentres,
} from "./fixture";

test.use({ ...devices["Pixel 7"] });

test("the settings menu fits a phone and stacks the controls", async ({
  page,
}) => {
  await serveFixture(page);
  await page.goto(`/learn?${playerQuery()}`);
  await expect(page.locator("canvas")).toBeVisible();

  await page.getByRole("button", { name: "Settings" }).click();

  const keys = page.getByLabel("Piano key width");
  await expect(keys).toBeVisible();

  for (const slider of [keys, page.getByLabel("Song position")]) {
    const box = await slider.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(24);
  }

  await expect(page.getByText("computer keyboard")).toBeVisible();
});

test("the input row sits at the bottom of the menu with a status light", async ({
  page,
}) => {
  await serveFixture(page);
  await page.goto(`/learn?${playerQuery()}`);
  await page.getByRole("button", { name: "Settings" }).click();

  const sections = page.locator("section", { has: page.locator("h3.label") });
  await expect(sections.last().getByText("computer keyboard")).toBeVisible();

  const light = sections.last().locator("span[aria-hidden='true']").first();
  await expect(light).toHaveClass(/bg-warn/);
});

test("the speed slider replaces the speed buttons", async ({ page }) => {
  await serveFixture(page);
  await page.goto(`/watch?${playerQuery()}`);
  await page.getByRole("button", { name: "Speed" }).click();

  await expect(page.getByRole("button", { name: "1.5x" })).toHaveCount(0);

  const speed = page.getByLabel("Playback speed");
  // It sits over the keyboard band on a phone, so it has to stay tappable.
  const box = await speed.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(24);

  await speed.fill("5");
  // The trigger is icon only on a phone, so the panel is where the value reads.
  await expect(speed).toHaveAttribute("aria-valuetext", "1.5x");
  await expect(page).toHaveURL(/speed=1.5/);
});

test("widening the keys leaves fewer, wider keys on screen", async ({
  page,
}) => {
  await serveFixture(page);
  await page.goto(`/learn?${playerQuery()}`);
  await expect(page.locator("canvas")).toBeVisible();

  const narrow = await whiteKeyCentres(page);
  expect(narrow.length).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByLabel("Piano key width").fill("64");
  await page.keyboard.press("Escape");

  await expect
    .poll(async () => (await whiteKeyCentres(page)).length)
    .toBeLessThan(narrow.length);
});

test("sliding along the keyboard plays every key it crosses", async ({
  page,
}) => {
  await serveFixture(page);
  await page.goto(`/learn?${playerQuery()}`);
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();

  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByLabel("Piano key width").fill("64");
  await page.keyboard.press("Escape");

  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const keyRow = (box?.height ?? 0) - keyRowFromBottom;

  const centres = await whiteKeyCentres(page);
  const first = centres[1] ?? 0;
  const second = centres[2] ?? 0;
  expect(second).toBeGreaterThan(first);

  await page.mouse.move((box?.x ?? 0) + first, (box?.y ?? 0) + keyRow);
  await page.mouse.down();
  await expect.poll(async () => isStruckKey(page, first)).toBe(true);

  await page.mouse.move((box?.x ?? 0) + second, (box?.y ?? 0) + keyRow, {
    steps: 8,
  });
  await expect.poll(async () => isStruckKey(page, second)).toBe(true);
  await expect.poll(async () => isStruckKey(page, first)).toBe(false);

  await page.mouse.up();
  await expect.poll(async () => isStruckKey(page, second)).toBe(false);
});

test("the roll opens on the part being played, not the lowest keys", async ({
  page,
}) => {
  await serveFixture(page);
  await page.goto(`/learn?${playerQuery()}`);
  await expect(page.locator("canvas")).toBeVisible();

  // A phone shows a slice of the keyboard, so notes off to the right would
  // leave the player staring at an empty roll.
  await expect.poll(async () => brightNotePixels(page)).toBeGreaterThan(1000);
});

test("the mode, view and simplify controls fit the header and stay reachable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await serveFixture(page);
  await page.goto(`/learn?${playerQuery()}`);
  await expect(page.locator("canvas")).toBeVisible();

  const header = page.locator("header");
  const hasOverflow = await header.evaluate(
    (node) => node.scrollWidth > node.clientWidth + 1,
  );
  expect(hasOverflow).toBe(false);

  const mode = page.getByRole("button", { name: "Mode: Learn" });
  await expect(mode).toBeVisible();
  await mode.click();
  const watch = page.getByRole("link", { name: "Watch" });
  await expect(watch).toBeVisible();
  expect((await watch.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await page.keyboard.press("Escape");

  const view = page.getByRole("button", { name: "View" });
  await view.click();
  const split = page.getByRole("button", { name: "Split" });
  await expect(split).toBeVisible();
  expect((await split.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Simplify" }).click();
  const toggle = page.getByRole("switch", { name: "Simplify" });
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(page.getByLabel("Maximum notes per second")).toBeVisible();
});
