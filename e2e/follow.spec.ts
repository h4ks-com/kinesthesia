import { expect, type Page, test } from "@playwright/test";
import { Midi } from "@tonejs/midi";
import { seenTour, serveMidi } from "./fixture";

const wideUrl = "https://example.test/wide.mid";

/** A line that walks most of the keyboard, so the note being asked for leaves a
 * phone's screen unless the view goes with it. */
function wideMidi(): Uint8Array {
  const midi = new Midi();
  const track = midi.addTrack();
  for (let i = 0; i < 50; i += 1) {
    track.addNote({ midi: 30 + i, time: i * 0.35, duration: 0.3 });
  }
  return new Uint8Array(midi.toArray());
}

/** Where the black keys fall along a row encodes how far the view is panned, so
 * comparing the pattern is asking whether the keyboard moved. */
async function keyboardPattern(page: Page): Promise<string> {
  return page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (canvas === null) {
      return "";
    }
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
      return "";
    }
    const ratio = canvas.width / canvas.getBoundingClientRect().width;
    const row = Math.round(canvas.height - 60 * ratio);
    const data = ctx.getImageData(0, row, canvas.width, 1).data;
    let out = "";
    for (let x = 0; x < canvas.width; x += Math.round(4 * ratio)) {
      out += (data[x * 4] ?? 0) > 120 ? "1" : "0";
    }
    return out;
  });
}

async function walkTheSong(
  page: Page,
  simple: boolean,
): Promise<{ opening: string; later: string }> {
  await page.setViewportSize({ width: 390, height: 780 });
  await seenTour(page);
  await serveMidi(page, wideUrl, wideMidi());
  await page.goto(
    `/watch?url=${encodeURIComponent(wideUrl)}&name=Wide&source=url${
      simple ? "&simple=1" : ""
    }`,
  );
  await page.locator("canvas").first().waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Play", exact: true }).click();
  const opening = await keyboardPattern(page);
  await page.waitForTimeout(9000);
  return { opening, later: await keyboardPattern(page) };
}

test("one note at a time brings the keyboard to the note", async ({ page }) => {
  const { opening, later } = await walkTheSong(page, true);
  expect(opening.length).toBeGreaterThan(10);
  expect(later).not.toBe(opening);
});

test("the whole part leaves the keyboard where the player put it", async ({
  page,
}) => {
  const { opening, later } = await walkTheSong(page, false);
  expect(opening.length).toBeGreaterThan(10);
  expect(later).toBe(opening);
});
