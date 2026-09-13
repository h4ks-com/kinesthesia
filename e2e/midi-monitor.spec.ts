import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { fakeMidiDevice, seenTour } from "./fixture";

async function openMonitor(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("switch", { name: /show midi events/ }).click();
  await expect(
    page.getByRole("complementary", { name: "MIDI events" }),
  ).toBeVisible();
}

test("the midi event list records what the device sends while it is open", async ({
  page,
}) => {
  await seenTour(page);
  await fakeMidiDevice(page);
  await page.goto("/play");
  await expect(page.locator("canvas").first()).toBeVisible();

  await page.evaluate(() => window.sendMidi([0x90, 40, 90]));

  await openMonitor(page);
  const panel = page.getByRole("complementary", { name: "MIDI events" });
  await expect(panel.getByText("play or move a control")).toBeVisible();

  await page.evaluate(() => {
    window.sendMidi([0x90, 60, 100]);
    window.sendMidi([0xf8]);
    window.sendMidi([0xb1, 1, 127]);
    window.sendMidi([0xf0, 0x43, 0x10, 0x4c, 0x10, 0x00, 0x0b, 0x40, 0xf7]);
  });

  const rows = panel.locator("tbody tr");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("note on");
  await expect(rows.nth(0)).toContainText("C4 60 · 100");
  await expect(rows.nth(1)).toContainText("#1 = 127");
  await expect(rows.nth(2)).toContainText("F0 43 10 4C 10 00 0B 40 F7");

  const download = page.waitForEvent("download");
  await panel.getByRole("button", { name: "Download as CSV" }).click();
  const csv = await readFile(await (await download).path(), "utf8");
  expect(csv.split("\n")).toHaveLength(5);
  expect(csv).toContain("Stand-in Keyboard,,clock,,,F8");

  await panel
    .getByRole("button", { name: "Close midi events" })
    .press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(page.locator("canvas").first()).toBeVisible();
});
