import { expect, test } from "@playwright/test";
import { Midi } from "@tonejs/midi";
import {
  isIdleKey,
  pixelAt,
  seenTour,
  serveMidi,
  whiteKeyCentres,
} from "./fixture";

const songUrl = "https://example.test/sustain.mid";

/** One short note held under a long pedal press. The written note is a quarter
 * of a second; the pedal carries the sound for four more. */
const noteAt = 4;
const noteLength = 0.25;
const pedalUp = 8;

function pedalledMidi(): Uint8Array {
  const midi = new Midi();
  const track = midi.addTrack();
  track.addNote({
    midi: 60,
    time: noteAt,
    duration: noteLength,
    velocity: 0.9,
  });
  track.addCC({ number: 64, value: 1, time: noteAt - 0.1 });
  track.addCC({ number: 64, value: 0, time: pedalUp });
  // A later note keeps the song running past the pedal lift.
  track.addNote({ midi: 72, time: 11, duration: 0.5, velocity: 0.9 });
  return new Uint8Array(midi.toArray());
}

async function open(page: import("@playwright/test").Page): Promise<void> {
  await seenTour(page);
  await serveMidi(page, songUrl, pedalledMidi());
  await page.goto(
    `/watch?url=${encodeURIComponent(songUrl)}&name=Sustain&source=bitmidi`,
  );
  await expect(page.locator("canvas")).toBeVisible();
  // The keybed is painted a frame or two after the canvas appears, so sampling
  // waits for the keys themselves rather than for the element.
  await expect
    .poll(async () => (await whiteKeyCentres(page)).length, { timeout: 10000 })
    .toBeGreaterThan(0);
}

/** Counts the white keys wearing a track colour on the given row. */
async function litKeys(
  page: import("@playwright/test").Page,
  centres: readonly number[],
  row: number,
): Promise<number> {
  const pixels = await Promise.all(centres.map((x) => pixelAt(page, x, row)));
  return pixels.filter((pixel) => !isIdleKey(pixel)).length;
}

test("a pedalled note stops lighting its key once the hand leaves", async ({
  page,
}) => {
  await open(page);
  const centres = await whiteKeyCentres(page);
  expect(centres.length).toBeGreaterThan(0);

  const box = await page.locator("canvas").boundingBox();
  const height = box?.height ?? 0;
  const litRow = height - 40;
  const seek = page.getByRole("slider", { name: "Song position" });

  // Sounding: the key wears its track colour.
  await seek.fill(String(noteAt));
  await page.waitForTimeout(300);
  expect(await litKeys(page, centres, litRow)).toBeGreaterThan(0);

  // Held by the pedal alone: still down, but the light belongs to the strike.
  await seek.fill("6");
  await page.waitForTimeout(300);
  expect(await litKeys(page, centres, litRow)).toBe(0);

  // Well above the keys the roll must be empty: the written note ended a second
  // ago, so the pedal must not have drawn a bar up there.
  const rollRow = height * 0.45;
  const roll = await Promise.all(centres.map((x) => pixelAt(page, x, rollRow)));
  const bars = roll.filter((pixel) => {
    const [red, green, blue] = pixel;
    return (red ?? 0) + (green ?? 0) + (blue ?? 0) > 150;
  });
  expect(bars).toHaveLength(0);
});

test("the key stays dark from the note ending until the next one lands", async ({
  page,
}) => {
  await open(page);
  const centres = await whiteKeyCentres(page);
  const box = await page.locator("canvas").boundingBox();
  const height = box?.height ?? 0;
  const row = height - 40;
  const seek = page.getByRole("slider", { name: "Song position" });

  const litAt = async (at: string): Promise<number> => {
    await seek.fill(at);
    await page.waitForTimeout(300);
    return litKeys(page, centres, row);
  };

  // All three in one context, so the dark assertions cannot pass by the key
  // never having lit at all.
  expect(await litAt(String(noteAt))).toBeGreaterThan(0);
  expect(await litAt("6")).toBe(0);
  expect(await litAt(String(pedalUp + 2))).toBe(0);
});
