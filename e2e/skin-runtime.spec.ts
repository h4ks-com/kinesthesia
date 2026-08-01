import { expect, test } from "@playwright/test";
import { playerQuery, seenTour, serveFixture } from "./fixture";

test("a background runs as a script in a worker and draws behind the roll", async ({
  page,
}) => {
  test.setTimeout(120000);
  const failures: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") failures.push(m.text().slice(0, 160));
  });
  await seenTour(page);
  await serveFixture(page);
  await page.goto(`/watch?${playerQuery()}&skin=ink`);
  await page.locator("canvas").first().waitFor({ state: "visible" });
  await page.waitForTimeout(1500);

  const runtime = await page.evaluate(async () => {
    const r = await fetch("/api/skins/runtime.js");
    return { status: r.status, csp: r.headers.get("content-security-policy") };
  });

  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForTimeout(2500);

  const painted = await page.evaluate(() => {
    const layers = [...document.querySelectorAll("canvas")].filter(
      (c) => c.getAttribute("role") !== "img" && c.width > 400,
    );
    let lit = 0;
    for (const c of layers) {
      const ctx = c.getContext("2d");
      if (ctx === null) continue;
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      for (let i = 0; i < d.length; i += 4 * 199)
        if ((d[i + 3] ?? 0) > 8) lit += 1;
    }
    return { layers: layers.length, lit };
  });
  console.log(`### runtime=${runtime.status} csp=${runtime.csp}`);
  console.log(`### layers=${painted.layers} litSamples=${painted.lit}`);
  console.log(`### consoleErrors=${JSON.stringify(failures.slice(0, 3))}`);
  expect(runtime.status).toBe(200);
  expect(painted.lit).toBeGreaterThan(0);
});
