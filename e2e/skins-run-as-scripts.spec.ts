import { expect, test } from "@playwright/test";
import { playerQuery, seenTour, serveFixture } from "./fixture";

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
    await page.waitForTimeout(2600);
    const lit = await page.evaluate(() => {
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
    console.log(
      `### ${id} lit=${lit} broke=${JSON.stringify(broke.slice(0, 1))}`,
    );
    expect(broke).toHaveLength(0);
    expect(lit).toBeGreaterThan(0);
  });
}
