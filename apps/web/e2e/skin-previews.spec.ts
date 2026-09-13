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
  /** Walks the list down a screenful and starts again from the top on reaching
   * the bottom, so every tile in between comes near and starts, not only the
   * last screenful. The list grows as tiles mount, so how far down the bottom
   * is depends on how fast this machine mounts them, and one pass measured
   * against an early height falls short. The modal scrolls on its overlay
   * rather than the dialog, so the scroller is found from the dialog. */
  const walkDown = async (): Promise<void> => {
    await dialog.evaluate((dialogEl) => {
      let node = dialogEl.parentElement;
      while (node !== null) {
        if (["auto", "scroll"].includes(getComputedStyle(node).overflowY)) {
          const next = node.scrollTop + node.clientHeight * 0.75;
          node.scrollTo(0, next >= node.scrollHeight ? 0 : next);
          return;
        }
        node = node.parentElement;
      }
    });
  };

  /** How many layers the picker has mounted. Counting them touches no pixels,
   * which matters while the walk down is still going: the previews answer their
   * frames on this same main thread, and a background that misses the answer is
   * one the app switches off. */
  const layers = async (): Promise<number> =>
    page.evaluate(
      () => document.querySelectorAll('[role="dialog"] canvas').length,
    );

  /** Each background is given two layers and the worker paints the composite
   * onto one of them, so a background has drawn when its pair has anything. */
  const drawn = async (): Promise<number[]> => {
    const previews = await page.evaluate(() =>
      [
        ...document.querySelectorAll<HTMLCanvasElement>(
          '[role="dialog"] canvas',
        ),
      ].map((canvas) => {
        const ctx = canvas.getContext("2d");
        if (ctx === null || canvas.width === 0) return 0;
        const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let lit = 0;
        for (let i = 0; i < d.length; i += 4 * 31)
          if ((d[i + 3] ?? 0) > 6) lit += 1;
        return lit;
      }),
    );
    const pairs: number[] = [];
    for (let at = 0; at + 1 < previews.length; at += 2) {
      pairs.push((previews[at] ?? 0) + (previews[at + 1] ?? 0));
    }
    return pairs;
  };

  // Every background gets a pair of layers once it has been near enough to be
  // looked at, so the walk down carries on until they are all there. Scrolling a
  // dialog full of running previews is itself work, so it stops once they are.
  await expect
    .poll(
      async () => {
        await walkDown();
        return layers();
      },
      { timeout: 60_000, intervals: [1000] },
    )
    .toBeGreaterThanOrEqual(18);

  // Not one of them may come up empty, which is what a dead worker looks like.
  // How long every worker takes to start, build its shader and paint belongs to
  // the machine, so the count is waited for rather than slept on. The reading is
  // kept from the poll rather than taken again: reading twenty canvases back
  // holds this thread, and the previews answer their frames on it.
  let lit: number[] = [];
  await expect
    .poll(
      async () => {
        lit = await drawn();
        return lit.filter((count) => count === 0).length;
      },
      { timeout: 60_000, intervals: [1000] },
    )
    .toBe(0);

  console.log(`### lit=${JSON.stringify(lit)}`);
  console.log(`### broke=${JSON.stringify(broke.slice(0, 2))}`);
  expect(broke).toHaveLength(0);
});
