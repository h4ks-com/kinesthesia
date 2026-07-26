import { expect, test } from "@playwright/test";
import { seenTour, serveFixture, settingStored, songUrl } from "./fixture";

const watchPath = `/watch?url=${encodeURIComponent(songUrl)}&name=Fixture`;

type Page = import("@playwright/test").Page;

async function openPlay(page: Page): Promise<void> {
  await seenTour(page);
  await page.goto("/play");
  await expect(page.locator("canvas")).toBeVisible();
}

async function openPicker(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: /background/i }).click();
  await expect(page.getByRole("dialog", { name: "Background" })).toBeVisible();
}

test("free roam offers a background and starts on the plain roll", async ({
  page,
}) => {
  await openPlay(page);
  await openPicker(page);
  await expect(page.getByRole("button", { name: /^Plain/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("choosing one mounts a layer behind the roll and closes the picker", async ({
  page,
}) => {
  await openPlay(page);
  expect(await page.locator("canvas").count()).toBe(1);

  await openPicker(page);
  await page.getByRole("button", { name: /Deep space/ }).click();
  await expect(page.getByRole("dialog", { name: "Background" })).toHaveCount(0);

  // The roll keeps its own canvas and the skin is given two more behind it.
  await expect(page.locator("canvas")).toHaveCount(3);
  await expect(page.getByRole("img", { name: /Piano roll/ })).toBeVisible();
});

test("the choice is remembered for the next visit", async ({ page }) => {
  await openPlay(page);
  await openPicker(page);
  await page.getByRole("button", { name: /Deep space/ }).click();
  // The write is debounced, so a reload fired off the click alone can beat it.
  await settingStored(page, "skin", "starfield");

  await page.reload();
  await expect(page.locator("canvas")).toHaveCount(3);
});

test("going back to plain takes the layer away again", async ({ page }) => {
  await openPlay(page);
  await openPicker(page);
  await page.getByRole("button", { name: /Deep space/ }).click();
  await expect(page.locator("canvas")).toHaveCount(3);

  await openPicker(page);
  await page.getByRole("button", { name: /^Plain/ }).click();
  await expect(page.locator("canvas")).toHaveCount(1);
});

test.describe("in watch", () => {
  async function openWatch(page: Page): Promise<void> {
    await serveFixture(page);
    await page.goto(watchPath);
    await expect(page.locator("canvas")).toBeVisible();
  }

  test("picking one puts it behind the roll and names it in the menu", async ({
    page,
  }) => {
    await openWatch(page);
    expect(await page.locator("canvas").count()).toBe(1);

    await openPicker(page);
    await page.getByRole("button", { name: /^Ember/ }).click();
    await expect(page.getByRole("dialog", { name: "Background" })).toHaveCount(
      0,
    );
    await expect(page.locator("canvas")).toHaveCount(3);

    await page.getByRole("button", { name: "Settings" }).click();
    await expect(
      page.getByRole("button", { name: /background/i }),
    ).toContainText("ember");
  });

  test("every background on offer can be picked and takes effect", async ({
    page,
  }) => {
    await openWatch(page);
    for (const name of [
      "Deep space",
      "Cruising",
      "Aurora",
      "Rainfall",
      "Abyss",
      "Horizon",
      "Ember",
      "Ink",
    ]) {
      await openPicker(page);
      await page.getByRole("button", { name: new RegExp(`^${name}`) }).click();
      await expect(page.locator("canvas")).toHaveCount(3);
      await openPicker(page);
      await expect(
        page.getByRole("button", { name: new RegExp(`^${name}`) }),
      ).toHaveAttribute("aria-pressed", "true");
      await page.getByRole("button", { name: "Close" }).click();
    }
  });

  /** The system asking for less movement is a default, not a lock: a link is
   * refused, a deliberate pick is not. A nested `test.use` does not reach the
   * page, so the context is built by hand. */
  test.describe("with reduced motion", () => {
    test("a background named by a link is left off", async ({ browser }) => {
      const context = await browser.newContext({ reducedMotion: "reduce" });
      const page = await context.newPage();
      await serveFixture(page);
      await page.goto(`${watchPath}&skin=ember`);
      await expect(page.locator("canvas")).toBeVisible();
      await page.getByRole("button", { name: "Settings" }).click();
      await expect(
        page.getByRole("button", { name: /background/i }),
      ).toContainText("plain");
      await context.close();
    });

    test("one picked by hand is still honoured", async ({ browser }) => {
      const context = await browser.newContext({ reducedMotion: "reduce" });
      const page = await context.newPage();
      await serveFixture(page);
      await page.goto(watchPath);
      await expect(page.locator("canvas")).toBeVisible();
      await openPicker(page);
      await page.getByRole("button", { name: /^Ember/ }).click();
      await expect(page.locator("canvas")).toHaveCount(3);
      await context.close();
    });
  });

  test("the notes can be turned around and back", async ({ page }) => {
    await openWatch(page);
    await page.getByRole("button", { name: "Settings" }).click();
    const toggle = page.getByRole("switch", { name: /notes rise/ });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  test("a background flown through turns the notes around with it", async ({
    page,
  }) => {
    await openWatch(page);
    await openPicker(page);
    await page.getByRole("button", { name: /Cruising/ }).click();
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(
      page.getByRole("switch", { name: /notes rise/ }),
    ).toHaveAttribute("aria-checked", "true");
  });

  test("one that only reads coming down turns them back and holds them", async ({
    page,
  }) => {
    await openWatch(page);
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("switch", { name: /notes rise/ }).click();
    await page.getByRole("button", { name: /background/i }).click();
    await page.getByRole("button", { name: /^Rainfall/ }).click();
    await page.getByRole("button", { name: "Settings" }).click();
    const toggle = page.getByRole("switch", { name: /notes rise/ });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    // Held by the background, so it can never vanish under the player.
    await expect(toggle).toBeDisabled();
  });

  test("turning the notes around never drops the background", async ({
    page,
  }) => {
    await openWatch(page);
    await openPicker(page);
    await page.getByRole("button", { name: /^Horizon/ }).click();
    await expect(page.locator("canvas")).toHaveCount(3);
    await page.getByRole("button", { name: "Settings" }).click();
    await page
      .getByRole("switch", { name: /notes rise/ })
      .click({ force: true });
    await expect(page.locator("canvas")).toHaveCount(3);
    await expect(
      page.getByRole("button", { name: /background/i }),
    ).toContainText("horizon");
  });

  test("a link carries the direction, so a shared view arrives the same", async ({
    page,
  }) => {
    await serveFixture(page);
    await page.goto(`${watchPath}&rise=1`);
    await expect(page.locator("canvas")).toBeVisible();
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(
      page.getByRole("switch", { name: /notes rise/ }),
    ).toHaveAttribute("aria-checked", "true");
  });
});

test("learn offers the backgrounds that read with notes coming down", async ({
  page,
}) => {
  await serveFixture(page);
  await page.goto(`/learn?url=${encodeURIComponent(songUrl)}&name=Fixture`);
  await expect(page.locator("canvas")).toBeVisible();
  await openPicker(page);
  for (const name of ["Aurora", "Rainfall", "Horizon", "Ink"]) {
    await expect(
      page.getByRole("button", { name: new RegExp(`^${name}`) }),
    ).toBeVisible();
  }
  // Nothing flown through, and no way to turn the notes around.
  await expect(page.getByRole("button", { name: /Cruising/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("switch", { name: /notes rise/ })).toHaveCount(0);
});

test.describe("remembering the choice", () => {
  const openWatch = async (page: Page): Promise<void> => {
    await serveFixture(page);
    await page.goto(watchPath);
    await expect(page.locator("canvas")).toBeVisible();
  };

  test("a background picked in watch is there on the next visit", async ({
    page,
  }) => {
    await openWatch(page);
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: /background/i }).click();
    await page.getByRole("button", { name: /^Ember/ }).click();
    await settingStored(page, "skin", "ember");

    await page.reload();
    await expect(page.locator("canvas")).toHaveCount(3);
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(
      page.getByRole("button", { name: /background/i }),
    ).toContainText("ember");
  });

  test("the direction is remembered with everything else", async ({ page }) => {
    await openWatch(page);
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("switch", { name: /notes rise/ }).click();
    await settingStored(page, "rise", true);

    await page.reload();
    await expect(page.locator("canvas")).toBeVisible();
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(
      page.getByRole("switch", { name: /notes rise/ }),
    ).toHaveAttribute("aria-checked", "true");
  });

  test("a link outranks what this device remembers, for that visit", async ({
    page,
  }) => {
    await openWatch(page);
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: /background/i }).click();
    await page.getByRole("button", { name: /^Ember/ }).click();
    await settingStored(page, "skin", "ember");

    await page.goto(`${watchPath}&skin=abyss`);
    await expect(page.locator("canvas")).toHaveCount(3);
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(
      page.getByRole("button", { name: /background/i }),
    ).toContainText("abyss");
  });
});
