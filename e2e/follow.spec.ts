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
      // Read by brightness rather than by one channel: a lit key wears its
      // part's colour, and a colour with little red in it is no darker than one
      // full of it. The cut sits well under the dimmest key face and well over
      // a black one, which is the only distinction this pattern needs.
      const bright =
        (data[x * 4] ?? 0) * 0.299 +
        (data[x * 4 + 1] ?? 0) * 0.587 +
        (data[x * 4 + 2] ?? 0) * 0.114;
      out += bright > 35 ? "1" : "0";
    }
    return out;
  });
}

/** The pattern once it has stopped changing, so nothing is read while the keys
 * are still going out. */
async function settledPattern(page: Page): Promise<string> {
  let last = await keyboardPattern(page);
  await expect
    .poll(async () => {
      const now = await keyboardPattern(page);
      const steady = now === last;
      last = now;
      return steady;
    })
    .toBe(true);
  return last;
}

async function walkTheSong(
  page: Page,
  mode: "watch" | "learn",
  simple: boolean,
): Promise<{ opening: string; later: string }> {
  await page.setViewportSize({ width: 390, height: 780 });
  await seenTour(page);
  await serveMidi(page, wideUrl, wideMidi());
  await page.goto(
    `/${mode}?url=${encodeURIComponent(wideUrl)}&name=Wide&source=url${
      simple ? "&simple=1" : ""
    }`,
  );
  await page.locator("canvas").first().waitFor({ state: "visible" });
  // Both readings are taken with nothing sounding, since a lit key is pale
  // wherever it sits and would otherwise read as the keyboard having moved.
  const opening = await settledPattern(page);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForTimeout(9000);
  await page.getByRole("button", { name: "Pause" }).click();
  return { opening, later: await settledPattern(page) };
}

test("one note at a time brings the keyboard to the note", async ({ page }) => {
  const { opening, later } = await walkTheSong(page, "learn", true);
  expect(opening.length).toBeGreaterThan(10);
  expect(later).not.toBe(opening);
});

test("the whole part leaves the keyboard where the player put it", async ({
  page,
}) => {
  const { opening, later } = await walkTheSong(page, "learn", false);
  expect(opening.length).toBeGreaterThan(10);
  expect(later).toBe(opening);
});

test("watching never moves the keyboard, since nothing is owed", async ({
  page,
}) => {
  // Simplify reduces the part a player owes, and watching owes none, so the
  // view has no single note to come to and must sit still.
  const { opening, later } = await walkTheSong(page, "watch", true);
  expect(opening.length).toBeGreaterThan(10);
  expect(later).toBe(opening);
});
