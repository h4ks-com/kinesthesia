import { expect, test } from "@playwright/test";
import { seenTour } from "./fixture";

type Page = import("@playwright/test").Page;

async function openPlay(page: Page): Promise<void> {
  await seenTour(page);
  await page.goto("/play");
  await expect(page.locator("canvas")).toBeVisible();
}

async function openPicker(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: /background/i }).click();
  await expect(page.getByRole("dialog", { name: "Background" })).toBeVisible();
}

test("free roam offers a background and starts on the plain roll", async ({
  page,
}) => {
  await openPlay(page);
  await openPicker(page);
  await expect(page.getByRole("button", { name: /^Plain/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("choosing one mounts a layer behind the roll and closes the picker", async ({
  page,
}) => {
  await openPlay(page);
  expect(await page.locator("canvas").count()).toBe(1);

  await openPicker(page);
  await page.getByRole("button", { name: /Deep space/ }).click();
  await expect(page.getByRole("dialog", { name: "Background" })).toHaveCount(0);

  // The roll keeps its own canvas and the skin is given two more behind it.
  await expect(page.locator("canvas")).toHaveCount(3);
  await expect(page.getByRole("img", { name: /Piano roll/ })).toBeVisible();
});

test("the choice is remembered for the next visit", async ({ page }) => {
  await openPlay(page);
  await openPicker(page);
  await page.getByRole("button", { name: /Deep space/ }).click();
  await page.waitForTimeout(500);

  await page.reload();
  await expect(page.locator("canvas")).toHaveCount(3);
});

test("going back to plain takes the layer away again", async ({ page }) => {
  await openPlay(page);
  await openPicker(page);
  await page.getByRole("button", { name: /Deep space/ }).click();
  await expect(page.locator("canvas")).toHaveCount(3);

  await openPicker(page);
  await page.getByRole("button", { name: /^Plain/ }).click();
  await expect(page.locator("canvas")).toHaveCount(1);
});
