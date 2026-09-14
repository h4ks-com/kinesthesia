import { expect, test } from "@playwright/test";
import { playerQuery, serveFixture, songName } from "./fixture";

/** The stage needs a camera. Chromium can be handed a synthetic one, which is
 * enough to walk the whole page: the runtime loads, the models fetch and the
 * draw loop runs against real frames. It never shows a keyboard, so what this
 * asserts is that the page stands up, not that a keybed is found. */
test.use({
  launchOptions: {
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
    ],
  },
  permissions: ["camera"],
});

test.describe("the stage", () => {
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "only Chromium takes a synthetic camera",
  );

  test("opens on the camera and looks for a keyboard", async ({ page }) => {
    const broken: string[] = [];
    page.on("pageerror", (error) => broken.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") {
        broken.push(message.text());
      }
    });

    await page.goto("/stage");
    await expect(
      page.getByText("Allow the camera so the stage can see your keyboard."),
    ).toBeVisible();
    await expect(page.getByText("Finding piano pattern")).toBeVisible();
    await expect(page.locator("canvas")).toBeVisible();
    await page.waitForTimeout(4000);
    expect(broken).toEqual([]);
  });

  test("plays a song onto the stage", async ({ page }) => {
    const broken: string[] = [];
    page.on("pageerror", (error) => broken.push(error.message));

    await serveFixture(page);
    await page.goto(`/stage?${playerQuery()}`);
    await expect(page.getByText(songName)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Play the song" }),
    ).toBeVisible();
    await page.waitForTimeout(2000);
    expect(broken).toEqual([]);
  });
});
