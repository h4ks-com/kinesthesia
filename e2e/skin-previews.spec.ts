import { expect, test } from "@playwright/test";
import { playerQuery, seenTour, serveFixture } from "./fixture";

/** The picker draws every background small. It is a different mount from the
 * roll's and broke on its own once, so it is checked on its own. A tile only
 * starts once it is near enough to be looked at, so this scrolls the whole
 * dialog before it counts anything. */
test("every background in the picker draws its own preview", async ({
  page,
}) => {
  test.setTimeout(120000);
  const broke: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") broke.push(m.text().slice(0, 160));
  });
  await seenTour(page);
  await serveFixture(page);
  await page.goto(`/watch?${playerQuery()}`);
  await page.locator("canvas").first().waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: /background/i }).click();
  const dialog = page.getByRole("dialog", { name: "Background" });
  await expect(dialog).toBeVisible();
  // Walked down rather than jumped to the end, so every tile in between comes
  // near and starts, not only the last screenful. The modal scrolls on its
  // overlay rather than the dialog, so the scroller is found from the dialog.
  for (let step = 0; step < 8; step += 1) {
    await dialog.evaluate((dialogEl, at) => {
      let node = dialogEl.parentElement;
      while (node !== null) {
        const overflowY = getComputedStyle(node).overflowY;
        if (overflowY === "auto" || overflowY === "scroll") {
          node.scrollTo(0, (node.scrollHeight / 8) * at);
          return;
        }
        node = node.parentElement;
      }
    }, step + 1);
    await page.waitForTimeout(400);
  }
  // Long enough for every worker to start, build its shader and paint.
  await page.waitForTimeout(6000);

  const previews = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    if (dialog === null) return [];
    return [...dialog.querySelectorAll("canvas")].map((c) => {
      const ctx = c.getContext("2d");
      if (ctx === null || c.width === 0) return 0;
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let lit = 0;
      for (let i = 0; i < d.length; i += 4 * 31)
        if ((d[i + 3] ?? 0) > 6) lit += 1;
      return lit;
    });
  });
  // Each background is given two layers and the worker paints the composite
  // onto one of them, so a background has drawn when its pair has anything.
  const drawn: number[] = [];
  for (let at = 0; at + 1 < previews.length; at += 2) {
    drawn.push((previews[at] ?? 0) + (previews[at + 1] ?? 0));
  }
  const blank = drawn.filter((lit) => lit === 0).length;
  console.log(
    `### backgrounds=${drawn.length} blank=${blank} lit=${JSON.stringify(drawn)}`,
  );
  console.log(`### broke=${JSON.stringify(broke.slice(0, 2))}`);
  expect(broke).toHaveLength(0);
  expect(drawn.length).toBeGreaterThanOrEqual(9);
  // Not one of them may come up empty, which is what a dead worker looks like.
  expect(blank).toBe(0);
});
