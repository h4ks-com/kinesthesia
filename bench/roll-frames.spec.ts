import { expect, test } from "@playwright/test";
import { Midi } from "@tonejs/midi";
import { seenTour, serveMidi } from "../e2e/fixture";

const denseUrl = "https://example.test/dense.mid";

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

const sampleFrames = () => {
  const gaps: number[] = [];
  let last = performance.now();
  let count = 0;
  const tick = (): void => {
    const now = performance.now();
    gaps.push(now - last);
    last = now;
    count += 1;
    if (count < 240) {
      requestAnimationFrame(tick);
    } else {
      (window as unknown as { __gaps: number[] }).__gaps = gaps;
    }
  };
  requestAnimationFrame(tick);
};

test("roll frame cost on a dense, bent song", async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: "http://localhost:3210",
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();
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

  await page.evaluate(sampleFrames);
  await page.waitForFunction(
    () => (window as unknown as { __gaps?: number[] }).__gaps !== undefined,
    undefined,
    { timeout: 30_000 },
  );
  const gaps = await page.evaluate(
    () => (window as unknown as { __gaps: number[] }).__gaps,
  );
  const sorted = [...gaps].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.floor(sorted.length * q)] ?? 0;
  const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length;
  console.log(
    `### frames=${gaps.length} mean=${mean.toFixed(2)}ms ` +
      `p50=${at(0.5).toFixed(2)}ms p95=${at(0.95).toFixed(2)}ms`,
  );
  await context.close();
  expect(gaps.length).toBeGreaterThan(0);
});
