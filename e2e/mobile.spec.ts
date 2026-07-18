import { devices, expect, test } from "@playwright/test";
import {
  keyIsLit,
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

  const speed = page.getByLabel("Playback speed");
  const keys = page.getByLabel("Piano key width");
  await expect(speed).toBeVisible();
  await expect(keys).toBeVisible();

  for (const slider of [speed, keys, page.getByLabel("Song position")]) {
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
  await page.getByRole("button", { name: "Settings" }).click();

  await expect(page.getByRole("button", { name: "1.5x" })).toHaveCount(0);

  const speed = page.getByLabel("Playback speed");
  await speed.fill("5");
  await expect(page.getByText("1.5x").first()).toBeVisible();
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
  await expect.poll(async () => keyIsLit(page, first)).toBe(true);

  await page.mouse.move((box?.x ?? 0) + second, (box?.y ?? 0) + keyRow, {
    steps: 8,
  });
  await expect.poll(async () => keyIsLit(page, second)).toBe(true);
  await expect.poll(async () => keyIsLit(page, first)).toBe(false);

  await page.mouse.up();
  await expect.poll(async () => keyIsLit(page, second)).toBe(false);
});
