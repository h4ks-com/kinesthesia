import { readFile } from "node:fs/promises";
import { type Download, expect, type Page, test } from "@playwright/test";
import { playerQuery, seenTour, serveFixture } from "./fixture";

const redDot =
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAEklEQVR4nGO4IyLyHx9mGBkKAFrGgMFixwLpAAAAAElFTkSuQmCC";

/** The only render this suite runs end to end. It is here because a background
 * that has to fetch something can hold the encoder up forever if the render
 * does not wait for it. */
test("a render with a picture behind it finishes", async ({ page }) => {
  test.setTimeout(180000);
  await seenTour(page);
  await serveFixture(page);
  await page.route("https://example.test/dot.png", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/png",
      headers: { "access-control-allow-origin": "*" },
      body: Buffer.from(redDot, "base64"),
    }),
  );
  await page.goto(
    `/watch?${playerQuery()}&skin=${encodeURIComponent("url(https://example.test/dot.png) scroll")}`,
  );
  await page.locator("canvas").first().waitFor({ state: "visible" });
  await page.waitForTimeout(1000);

  await page.getByRole("button", { name: "Render" }).click();
  const download = page.waitForEvent("download", { timeout: 150000 });
  await page.getByRole("button", { name: /video/i }).first().click();
  const file = await download;
  const path = await file.path();
  expect(path).not.toBeNull();
  expect(file.suggestedFilename()).toMatch(/\.(mp4|webm)$/);
});

/** What one frame of a finished render actually shows. Rows are read where the
 * three views differ: inside the notation, inside the falling notes, and along
 * the keyboard, which only a view with a roll in it draws. */
type Picture = {
  readonly rows: readonly number[];
  /** Pixels in the notation area at each end of the scale, so the same reading
   * finds ink on paper and ink on a dark panel. */
  readonly dark: number;
  readonly bright: number;
  /** Middles of the two markers, or null where one was never painted. */
  readonly cursor: Point | null;
  readonly nextMark: Point | null;
};

type Point = { readonly x: number; readonly y: number };

const rowShares = [0.25, 0.75, 0.98];

async function renderVideo(page: Page): Promise<Download> {
  await page.getByRole("button", { name: "Render" }).click();
  const download = page.waitForEvent("download", { timeout: 150000 });
  await page.getByRole("button", { name: /video/i }).first().click();
  return download;
}

async function chooseView(page: Page, label: string): Promise<void> {
  await page.getByRole("button", { name: "View" }).click();
  await page.getByRole("button", { name: label, exact: true }).click();
  await page.keyboard.press("Escape");
  await expect
    .poll(
      async () => page.getByTestId("sheet-view").locator("svg path").count(),
      {
        timeout: 20_000,
      },
    )
    .toBeGreaterThan(20);
}

/** Decodes one frame back out of the file and measures it, so what was written
 * is read rather than assumed. */
async function pictureFrom(
  page: Page,
  file: Download,
  atSecond: number,
  sheetShare: number,
): Promise<Picture> {
  const data = (await readFile(await file.path())).toString("base64");
  return page.evaluate(
    async ({ data, mime, atSecond, sheetShare, shares }) => {
      const blob = await (await fetch(`data:${mime};base64,${data}`)).blob();
      const video = document.createElement("video");
      video.muted = true;
      video.src = URL.createObjectURL(blob);
      await new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve();
        video.onerror = () => reject(new Error("the render would not decode"));
      });
      await new Promise<void>((resolve) => {
        video.onseeked = () => resolve();
        video.currentTime = atSecond;
      });
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (ctx === null) {
        throw new Error("no canvas to read the frame back on");
      }
      ctx.drawImage(video, 0, 0);
      const { width, height } = canvas;
      const { data: pixels } = ctx.getImageData(0, 0, width, height);
      const at = (index: number): number[] => [
        pixels[index] ?? 0,
        pixels[index + 1] ?? 0,
        pixels[index + 2] ?? 0,
      ];

      const rows = shares.map((share) => {
        const y = Math.min(height - 1, Math.floor(height * share));
        let sum = 0;
        for (let x = 0; x < width; x += 1) {
          const [red = 0, green = 0, blue = 0] = at((y * width + x) * 4);
          sum += (red + green + blue) / 3;
        }
        return sum / width;
      });

      let dark = 0;
      let bright = 0;
      const cursor = { x: 0, y: 0, count: 0 };
      const nextMark = { x: 0, y: 0, count: 0 };
      const bottom = Math.floor(height * sheetShare);
      for (let y = 0; y < bottom; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const [red = 0, green = 0, blue = 0] = at((y * width + x) * 4);
          const level = red + green + blue;
          if (level < 300) {
            dark += 1;
          } else if (level > 500) {
            bright += 1;
          }
          if (blue - red > 25 && blue > 60) {
            cursor.x += x;
            cursor.y += y;
            cursor.count += 1;
          } else if (red - blue > 60 && red > 90) {
            nextMark.x += x;
            nextMark.y += y;
            nextMark.count += 1;
          }
        }
      }
      const middle = (found: typeof cursor): { x: number; y: number } | null =>
        found.count === 0
          ? null
          : { x: found.x / found.count, y: found.y / found.count };
      return {
        rows,
        dark,
        bright,
        cursor: middle(cursor),
        nextMark: middle(nextMark),
      };
    },
    {
      data,
      mime: file.suggestedFilename().endsWith(".mp4")
        ? "video/mp4"
        : "video/webm",
      atSecond,
      sheetShare,
      shares: rowShares,
    },
  );
}

/** Split: the notation takes the top half of the picture and the falling notes
 * keep the bottom, each across the whole width, exactly as the page stacks
 * them. On paper, so the notation's own colours are read back too. */
test("a split render stacks the notation above the notes", async ({ page }) => {
  test.setTimeout(180000);
  await seenTour(page);
  await serveFixture(page);
  await page.goto(`/watch?${playerQuery()}`);
  await page.locator("canvas").first().waitFor({ state: "visible" });
  await chooseView(page, "Split");
  await page.getByRole("button", { name: "Invert notation colours" }).click();
  await page.waitForTimeout(500);

  const picture = await pictureFrom(page, await renderVideo(page), 3, 0.5);
  const [notation = 0, notes = 0, keyboard = 0] = picture.rows;
  expect(notation).toBeGreaterThan(170);
  expect(notes).toBeLessThan(100);
  // The roll is untouched under it, keyboard and all.
  expect(keyboard).toBeGreaterThan(140);
  // Staves, stems and noteheads, not an empty sheet of paper.
  expect(picture.dark).toBeGreaterThan(2000);
  // Both markers ride along: what is sounding, and what comes next.
  expect(picture.cursor).not.toBeNull();
  expect(picture.nextMark).not.toBeNull();
});

/** Sheet only: notation in place of the roll, on its own dark ground, and
 * following the music rather than sitting on the first bar. */
test("a sheet only render fills the picture and follows the music", async ({
  page,
}) => {
  test.setTimeout(180000);
  await seenTour(page);
  await serveFixture(page);
  await page.goto(`/watch?${playerQuery()}`);
  await page.locator("canvas").first().waitFor({ state: "visible" });
  await chooseView(page, "Sheet only");

  const file = await renderVideo(page);
  const opening = await pictureFrom(page, file, 0.2, 1);
  const later = await pictureFrom(page, file, 6, 1);
  const [notation = 0, lower = 0, keyboard = 0] = later.rows;
  expect(notation).toBeLessThan(90);
  expect(lower).toBeLessThan(90);
  // No roll means no keybed across the foot of the picture.
  expect(keyboard).toBeLessThan(90);
  expect(later.bright).toBeGreaterThan(2000);
  expect(later.cursor).not.toBeNull();
  expect(opening.cursor).not.toBeNull();
  // The marker has walked the score, or the score has walked under it.
  const moved =
    Math.abs((later.cursor?.x ?? 0) - (opening.cursor?.x ?? 0)) +
    Math.abs((later.cursor?.y ?? 0) - (opening.cursor?.y ?? 0));
  expect(moved).toBeGreaterThan(20);
});

/** The driven render: an address that asks for one starts it with nobody
 * clicking, and the file goes back to the server that asked rather than into a
 * downloads folder belonging to whichever machine held the browser. */
test("a render asked for by the address hands the file back", async ({
  page,
}) => {
  test.setTimeout(180000);
  const job = "11111111-2222-3333-4444-555555555555";
  const key = "66666666-7777-8888-9999-000000000000";

  let checked = 0;
  let handback: {
    key: string | null;
    extension: string | null;
    bytes: number;
  } | null = null;
  await page.route(`**/api/renders/${job}?**`, async (route) => {
    const request = route.request();
    const query = new URL(request.url()).searchParams;
    // The page asks whether a render is really waiting before it spends a
    // visitor's machine on one.
    if (request.method() === "GET") {
      checked += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ waiting: true }),
      });
      return;
    }
    handback = {
      key: query.get("key"),
      extension: query.get("extension"),
      bytes: (request.postDataBuffer() ?? Buffer.alloc(0)).byteLength,
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ url: "https://example.test/out.webm" }),
    });
  });

  await seenTour(page);
  await serveFixture(page);
  const download = page
    .waitForEvent("download", { timeout: 3000 })
    .catch(() => null);
  await page.goto(`/watch?${playerQuery()}&render=video&job=${job}&key=${key}`);
  await expect
    .poll(() => handback, { timeout: 150000, intervals: [1000] })
    .not.toBeNull();

  const seen = handback as unknown as {
    key: string;
    extension: string;
    bytes: number;
  };
  expect(checked).toBeGreaterThan(0);
  expect(seen.key).toBe(key);
  expect(seen.extension).toMatch(/^(mp4|webm)$/);
  // A real file, not an empty body dressed up as one.
  expect(seen.bytes).toBeGreaterThan(10000);
  // Nothing lands on the machine holding the browser.
  expect(await download).toBeNull();
});
