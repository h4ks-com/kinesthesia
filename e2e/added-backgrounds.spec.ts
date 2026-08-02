import { expect, type Page, test } from "@playwright/test";
import { seenTour } from "./fixture";

const magenta = `background({
  name: "Magenta",
  blurb: "A flat wash, so a tile is unmistakable.",
  create() {
    return {
      paint(ctx, view) {
        ctx.fillStyle = "rgb(200,0,160)";
        ctx.fillRect(0, 0, view.width, view.height);
      },
    };
  },
});`;

const dud = `background({
  name: "Dud",
  blurb: "Throws the moment it is asked to draw.",
  create() { return { paint() { throw new Error("nope"); } }; },
});`;

const listed = [
  { id: "11111111-1111-4111-8111-111111111111", name: "Magenta" },
  { id: "22222222-2222-4222-8222-222222222222", name: "Dud" },
];

/** The store is not reachable from a test run, so the listing and the two
 * scripts are served here. What is under test is the picker, not the bucket. */
async function serveAdded(page: Page): Promise<void> {
  await page.route("**/api/skins", async (route) => {
    const answer = await route.fetch();
    const listing = await answer.json();
    await route.fulfill({
      json: {
        ...listing,
        custom: listed.map((skin) => ({
          ...skin,
          blurb: skin.id === listed[0]?.id ? "A flat wash." : "Throws.",
          addedAt: 1,
        })),
      },
    });
  });
  for (const [at, skin] of listed.entries()) {
    await page.route(`**/api/skins/${skin.id}`, (route) =>
      route.fulfill({
        contentType: "text/javascript",
        body: at === 0 ? magenta : dud,
      }),
    );
  }
}

async function openPicker(page: Page): Promise<void> {
  await seenTour(page);
  await serveAdded(page);
  await page.goto("/play");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByText("background", { exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "visible" });
  // Waited for and then scrolled to, in that order: the section is only there
  // once the listing arrives, and a tile only starts drawing once it is near
  // enough to be looked at.
  const heading = page.getByRole("heading", { name: "Added" });
  await heading.waitFor({ state: "visible" });
  await heading.scrollIntoViewIfNeeded();
}

test("added backgrounds are offered after the built-in ones", async ({
  page,
}) => {
  test.setTimeout(120000);
  await openPicker(page);
  await expect(page.getByRole("heading", { name: "Added" })).toBeVisible();

  const built = await page
    .getByRole("heading", { name: "Default skins" })
    .evaluate((node) => node.getBoundingClientRect().top + window.scrollY);
  const added = await page
    .getByRole("heading", { name: "Added" })
    .evaluate((node) => node.getBoundingClientRect().top + window.scrollY);
  expect(added).toBeGreaterThan(built);

  await expect(page.getByRole("button", { name: /Magenta/ })).toBeEnabled();
});

test("one that will not run is shown as one that cannot be chosen", async ({
  page,
}) => {
  test.setTimeout(120000);
  await openPicker(page);
  // Asked of this tile rather than of the page: a device that cannot run a
  // shader says the same thing under every background that needs one, and an
  // unscoped match would then be answered by a tile this test never named.
  const broken = page.getByRole("button", { name: /Dud/ });
  await expect(broken).toHaveAttribute("aria-disabled", "true", {
    timeout: 15000,
  });
  await expect(broken).toContainText("Does not run here.");
  // Refused rather than removed from the tab order, so the reason is reachable.
  await broken.focus();
  await expect(broken).toBeFocused();
});

test("choosing one draws it behind the keys", async ({ page }) => {
  test.setTimeout(120000);
  await openPicker(page);
  await page.getByRole("button", { name: /Magenta/ }).click();
  await page.waitForTimeout(2500);

  const wash = await page.evaluate(() => {
    const layers = [...document.querySelectorAll("canvas")].filter(
      (c) => c.getAttribute("role") !== "img" && c.width > 400,
    );
    for (const canvas of layers) {
      const ctx = canvas.getContext("2d");
      if (ctx === null) continue;
      const [r, g, b, a] = ctx.getImageData(
        Math.round(canvas.width / 2),
        Math.round(canvas.height / 4),
        1,
        1,
      ).data;
      if ((a ?? 0) > 8 && (r ?? 0) > 120 && (b ?? 0) > 100 && (g ?? 0) < 80) {
        return true;
      }
    }
    return false;
  });
  expect(wash).toBe(true);
});
