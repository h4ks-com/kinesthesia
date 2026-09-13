import { expect, test } from "@playwright/test";
import { playerQuery, seenTour, serveFixture } from "./fixture";

// One at a time: each of these runs a shader in a worker, and ten of them
// racing each other starves the frame clock the backgrounds are watched by,
// which the app rightly reads as a device that cannot run them.
test.describe.configure({ mode: "serial" });

const ids = [
  "starfield",
  "cruise",
  "aurora",
  "rainfall",
  "abyss",
  "horizon",
  "ember",
  "ink",
  "flower",
  "smoke",
];

for (const id of ids) {
  test(`background ${id} runs as a script and draws`, async ({ page }) => {
    test.setTimeout(90000);
    const broke: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") broke.push(m.text().slice(0, 180));
    });
    await seenTour(page);
    await serveFixture(page);
    await page.goto(`/watch?${playerQuery()}&skin=${id}`);
    await page.locator("canvas").first().waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Play", exact: true }).click();
    // How long a worker takes to start, build its shader and paint belongs to
    // the machine, so the paint is waited for rather than slept on.
    const lit = async (): Promise<number> =>
      page.evaluate(() => {
        let seen = 0;
        for (const c of [...document.querySelectorAll("canvas")]) {
          if (c.getAttribute("role") === "img" || c.width === 0) continue;
          const ctx = c.getContext("2d");
          if (ctx === null) continue;
          const d = ctx.getImageData(0, 0, c.width, c.height).data;
          for (let i = 0; i < d.length; i += 4 * 199)
            if ((d[i + 3] ?? 0) > 8) seen += 1;
        }
        return seen;
      });
    // Reading whole canvases back is heavy enough to starve the worker being
    // asked about, so it is paced rather than run as fast as the poll will go.
    await expect
      .poll(lit, { timeout: 60_000, intervals: [1000] })
      .toBeGreaterThan(0);
    console.log(
      `### ${id} lit=${await lit()} broke=${JSON.stringify(broke.slice(0, 1))}`,
    );
    expect(broke).toHaveLength(0);
  });
}
