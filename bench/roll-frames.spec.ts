import { expect, test } from "@playwright/test";
import { Midi } from "@tonejs/midi";
import { seenTour, serveMidi } from "../e2e/fixture";

declare global {
  interface Window {
    __gaps: number[];
  }
}

const denseUrl = "https://example.test/dense.mid";
const sampled = 240;

/** A dense passage with bends, which is the roll at its most expensive. */
function denseMidi(): Uint8Array {
  const midi = new Midi();
  for (const program of [0, 24, 40, 48]) {
    const track = midi.addTrack();
    track.instrument.number = program;
    for (let i = 0; i < 900; i += 1) {
      track.addNote({
        midi: 40 + ((i * 7) % 40),
        time: i * 0.06,
        duration: 0.5,
      });
    }
    for (let i = 0; i < 400; i += 1) {
      track.addPitchBend({ time: i * 0.12, value: Math.sin(i / 8) * 0.5 });
    }
  }
  return new Uint8Array(midi.toArray());
}

const sampleFrames = (frames: number): void => {
  const gaps: number[] = [];
  let last = performance.now();
  const tick = (): void => {
    const now = performance.now();
    gaps.push(now - last);
    last = now;
    if (gaps.length < frames) {
      requestAnimationFrame(tick);
    } else {
      window.__gaps = gaps;
    }
  };
  requestAnimationFrame(tick);
};

test("roll frame cost on a dense, bent song", async ({ page }) => {
  await seenTour(page);
  await serveMidi(page, denseUrl, denseMidi());
  await page.goto(
    `/watch?url=${encodeURIComponent(denseUrl)}&name=Dense&source=url`,
    { timeout: 60_000 },
  );
  await page.locator("canvas").waitFor({ state: "visible", timeout: 30_000 });
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page
    .getByRole("button", { name: "Pause" })
    .waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForTimeout(1500);

  await page.evaluate(sampleFrames, sampled);
  await page.waitForFunction(() => window.__gaps !== undefined, undefined, {
    timeout: 30_000,
  });
  const gaps = await page.evaluate(() => window.__gaps);

  const sorted = [...gaps].sort((a, b) => a - b);
  const at = (quantile: number): number =>
    sorted[Math.floor(sorted.length * quantile)] ?? 0;
  const mean = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
  console.log(
    `### frames=${gaps.length} mean=${mean.toFixed(2)}ms ` +
      `p50=${at(0.5).toFixed(2)}ms p95=${at(0.95).toFixed(2)}ms`,
  );
  // A short sample is a misleading one, so a reading only counts if every frame
  // asked for turned up.
  expect(gaps).toHaveLength(sampled);
});
