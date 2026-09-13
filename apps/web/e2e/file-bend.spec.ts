import { expect, test } from "@playwright/test";
import { Midi } from "@tonejs/midi";
import { seenTour, serveMidi } from "./fixture";

const songUrl = "https://example.test/bent.mid";
const bendAt = 6;

/** One long note with the wheel swept part way through, so the same bar carries
 * a straight stretch and a bent one. */
function bentMidi(): Uint8Array {
  const midi = new Midi();
  const track = midi.addTrack();
  track.addNote({ midi: 60, time: 4, duration: 6, velocity: 0.9 });
  track.addPitchBend({ time: bendAt, value: 8191 });
  return new Uint8Array(midi.toArray());
}

async function open(
  page: import("@playwright/test").Page,
  rising = false,
): Promise<void> {
  await seenTour(page);
  await serveMidi(page, songUrl, bentMidi());
  await page.goto(
    `/watch?url=${encodeURIComponent(songUrl)}&name=Bent&source=bitmidi${
      rising ? "&rise=1" : ""
    }`,
  );
  await expect(page.locator("canvas")).toBeVisible();
  await page.waitForTimeout(700);
}

/** Centre of the note's body on one row of the roll. */
async function centreAt(
  page: import("@playwright/test").Page,
  fraction: number,
): Promise<number | null> {
  return page.evaluate((part) => {
    const canvas = document.querySelector("canvas");
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) {
      return null;
    }
    const ratio = canvas.width / canvas.clientWidth;
    const y = Math.round(canvas.clientHeight * (part ?? 0) * ratio);
    const { data } = ctx.getImageData(0, y, canvas.width, 1);
    let sum = 0;
    let weight = 0;
    for (let pixel = 0; pixel < canvas.width; pixel += 1) {
      const index = pixel * 4;
      const lit =
        (data[index] ?? 0) + (data[index + 1] ?? 0) + (data[index + 2] ?? 0);
      if (lit > 150) {
        sum += pixel * lit;
        weight += lit;
      }
    }
    return weight === 0 ? null : sum / weight / ratio;
  }, fraction);
}

/** How far the note's body on one row sits to the right of its body on another.
 * Null on either row, which is a roll that has yet to redraw, never satisfies a
 * comparison. */
async function gap(
  page: import("@playwright/test").Page,
  right: number,
  left: number,
): Promise<number | null> {
  const [onRight, onLeft] = await Promise.all([
    centreAt(page, right),
    centreAt(page, left),
  ]);
  return onRight === null || onLeft === null ? null : onRight - onLeft;
}

test("a bend written in the file bends the falling note", async ({ page }) => {
  await open(page);
  const seek = page.getByRole("slider", { name: "Song position" });
  // Parked before the bend, so the roll shows the note either side of it: the
  // stretch still to be played is higher up and already carries the wheel.
  await seek.fill("5");
  await expect
    .poll(async () => gap(page, 0.35, 0.72), { timeout: 15_000 })
    .toBeGreaterThan(15);
});

test("a rising note carries the bend on the half that has been played", async ({
  page,
}) => {
  await open(page, true);
  const seek = page.getByRole("slider", { name: "Song position" });
  // Climbing, with the wheel swept two seconds ago. A rising bar reads oldest at
  // the top and newest at the keys, which is the reverse of a falling one, so
  // the bend belongs near the line and the straight stretch above it.
  await seek.fill("8");
  // Reading the wheel the falling way round pins the bend to a row of the
  // screen rather than to the note, which shows up here as the two swapping.
  await expect
    .poll(async () => gap(page, 0.72, 0.2), { timeout: 15_000 })
    .toBeGreaterThan(15);
});
