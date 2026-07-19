import { expect, test } from "@playwright/test";
import { playerQuery, serveFixture } from "./fixture";

async function openSound(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Tracks" }).first().click();
  await page
    .getByRole("button", { name: /Change how .* sounds/ })
    .first()
    .click();
}

test("a track can be given another instrument", async ({ page }) => {
  await serveFixture(page);
  await page.goto(`/learn?${playerQuery()}`);
  await expect(page.locator("canvas")).toBeVisible();

  await openSound(page);

  // A hundred and twenty eight instruments only work grouped and searchable.
  await expect(
    page.getByRole("button", { name: "Acoustic grand piano" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Piano", { exact: true })).toBeVisible();

  await page.getByLabel("Search instruments").fill("marim");
  await expect(page.getByRole("button", { name: "Marimba" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Acoustic grand piano" }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Marimba" }).click();
  await expect(page.getByText(/Marimba\. Play a key/)).toBeVisible();
});

test("the reading position follows the view swap", async ({ page }) => {
  await serveFixture(page);
  await page.goto(`/learn?${playerQuery()}`);
  await expect(page.locator("canvas")).toBeVisible();

  // The button that opens the sound view is unmounted by opening it, so focus
  // has to be moved rather than dropped on the body.
  await openSound(page);
  await expect(
    page.getByRole("button", { name: "Back to tracks" }),
  ).toBeFocused();

  await page.getByRole("button", { name: "Back to tracks" }).click();
  await expect(
    page.getByRole("button", { name: /Change how .* sounds/ }).first(),
  ).toBeFocused();
});

test("the shaping controls show themselves to a keyboard", async ({ page }) => {
  await serveFixture(page);
  await page.goto(`/learn?${playerQuery()}`);
  await expect(page.locator("canvas")).toBeVisible();
  await openSound(page);

  // The curve is for pointers. A sighted keyboard user gets the same three
  // values as sliders, which have to be visible once focused.
  const attack = page.getByLabel("Attack in milliseconds");
  await expect(attack).not.toBeInViewport();
  await attack.focus();
  await expect(attack).toBeInViewport();
});

test("a search with no instrument says so", async ({ page }) => {
  await serveFixture(page);
  await page.goto(`/learn?${playerQuery()}`);
  await expect(page.locator("canvas")).toBeVisible();

  await openSound(page);
  await page.getByLabel("Search instruments").fill("zzzz");
  await expect(page.getByText("Nothing by that name.")).toBeVisible();
});

test("the envelope reads back what it is set to", async ({ page }) => {
  await serveFixture(page);
  await page.goto(`/learn?${playerQuery()}`);
  await expect(page.locator("canvas")).toBeVisible();

  await openSound(page);

  // Zero release lets the sample ring its own written length.
  await expect(page.getByText("rings on")).toBeVisible();

  await page.getByLabel("Release in milliseconds").fill("2000");
  await expect(page.getByText("2000 ms out")).toBeVisible();
  await page.getByLabel("Attack in milliseconds").fill("300");
  await expect(page.getByText("300 ms in")).toBeVisible();
  await page.getByLabel("Volume percent").fill("60");
  await expect(page.getByText("60%")).toBeVisible();
});

test("a shaped song offers to keep the sound, and to drop it", async ({
  page,
}) => {
  await serveFixture(page);
  await page.goto(`/learn?${playerQuery()}`);
  await expect(page.locator("canvas")).toBeVisible();

  await openSound(page);
  await page.getByLabel("Volume percent").fill("60");
  await page.getByRole("button", { name: "Back to tracks" }).click();

  await expect(page.getByText("Sign in to keep this")).toBeVisible();

  await page
    .getByRole("button", { name: "Back to the sounds in the file" })
    .click();
  await expect(page.getByText("Sign in to keep this")).toHaveCount(0);
});

for (const width of [390, 1280]) {
  test(`the envelope is draggable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await serveFixture(page);
    await page.goto(`/learn?${playerQuery()}`);
    await expect(page.locator("canvas")).toBeVisible();
    await openSound(page);

    const frame = await page.locator("svg.touch-none").boundingBox();
    const handle = await page
      .locator("svg.touch-none circle")
      .first()
      .boundingBox();
    expect(frame).not.toBeNull();
    // A handle at rest must sit inside the box, or there is nothing to grab.
    expect(handle?.x ?? 0).toBeGreaterThanOrEqual(frame?.x ?? 0);

    await page.mouse.move(
      (handle?.x ?? 0) + (handle?.width ?? 0) / 2,
      (handle?.y ?? 0) + (handle?.height ?? 0) / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      (frame?.x ?? 0) + (frame?.width ?? 0) * 0.2,
      (frame?.y ?? 0) + (frame?.height ?? 0) * 0.5,
      { steps: 8 },
    );
    await page.mouse.up();

    // The curve is stretched to fit its box, so the reading must not depend on
    // how wide that box is.
    await expect(page.getByText(/51\d ms in/)).toBeVisible();
    await expect(page.getByText("75%")).toBeVisible();
  });
}

const shaped = (program: number) => ({
  0: { program, attack: 0, release: 0, brightness: 20000, volume: 100 },
});

test("a song someone else shaped arrives that way, and others can be heard", async ({
  page,
}) => {
  await serveFixture(page);
  await page.route("**/api/voicings?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        voicings: [
          {
            authorId: "bo",
            authorName: "Bo",
            tracks: shaped(12),
            updatedAt: 2,
          },
          {
            authorId: "ana",
            authorName: "Ana",
            tracks: shaped(56),
            updatedAt: 1,
          },
        ],
      }),
    }),
  );

  await page.goto(`/learn?${playerQuery()}`);
  await expect(page.locator("canvas")).toBeVisible();
  await page.getByRole("button", { name: "Tracks" }).first().click();

  // Nobody signed in has a version of their own, so the newest one is playing.
  await expect(page.getByText("Sound by Bo")).toBeVisible();
  await page
    .getByRole("button", { name: /Change how .* sounds/ })
    .first()
    .click();
  await expect(page.getByText(/Marimba\. Play a key/)).toBeVisible();

  await page.getByRole("button", { name: "Back to tracks" }).click();
  await page.getByLabel("Whose sound to play").selectOption("ana");

  await expect(page.getByText("Sound by Ana")).toBeVisible();
  await page
    .getByRole("button", { name: /Change how .* sounds/ })
    .first()
    .click();
  await expect(page.getByText(/Trumpet\. Play a key/)).toBeVisible();
});
