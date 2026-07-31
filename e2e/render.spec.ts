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
