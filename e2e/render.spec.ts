import { expect, test } from "@playwright/test";
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
