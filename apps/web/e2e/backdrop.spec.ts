import { expect, type Page, test } from "@playwright/test";
import { playerQuery, seenTour, serveFixture, settingStored } from "./fixture";

/** A solid red picture, so a pixel read says plainly whether it was drawn and
 * what was done to its brightness. */
const redDot =
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAEklEQVR4nGO4IyLyHx9mGBkKAFrGgMFixwLpAAAAAElFTkSuQmCC";

async function servePicture(page: Page): Promise<void> {
  await page.route("https://example.test/dot.png", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/png",
      // A picture is only drawable on a canvas the export can read back, so it
      // has to say it may be used.
      headers: { "access-control-allow-origin": "*" },
      body: Buffer.from(redDot, "base64"),
    }),
  );
}

/** The strongest red on the layers behind the roll, which is the picture if it
 * was drawn at all. The roll itself is left out: its notes carry colours of
 * their own, and they are not what this is asking about. */
async function reddest(page: Page): Promise<number> {
  return page.evaluate(() => {
    // The roll names itself; everything else on the stack is background.
    const layers = [...document.querySelectorAll("canvas")].filter(
      (canvas) => canvas.getAttribute("role") !== "img",
    );
    let best = 0;
    for (const canvas of layers) {
      const ctx = canvas.getContext("2d");
      if (ctx === null || canvas.width === 0) {
        continue;
      }
      let data: Uint8ClampedArray;
      try {
        data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      } catch {
        // A tainted canvas would read as "no picture", which is the wrong
        // answer to every question here.
        throw new Error("the background canvas was tainted");
      }
      for (let i = 0; i < data.length; i += 4 * 97) {
        const red = data[i] ?? 0;
        const green = data[i + 1] ?? 0;
        const alpha = data[i + 3] ?? 0;
        if (alpha > 200 && red > green + 10) {
          best = Math.max(best, red);
        }
      }
    }
    return best;
  });
}

async function open(page: Page, skin: string | null): Promise<void> {
  await seenTour(page);
  await serveFixture(page);
  await servePicture(page);
  await page.goto(
    `/watch?${playerQuery()}${skin === null ? "" : `&skin=${encodeURIComponent(skin)}`}`,
  );
  await page.locator("canvas").first().waitFor({ state: "visible" });
  await page.waitForTimeout(1200);
}

/** How long a machine may take to fetch, decode and draw a picture. Waited for
 * rather than slept on, since that span is the machine's business. */
const drawTimeout = 15_000;

async function drawn(page: Page): Promise<void> {
  await expect
    .poll(async () => reddest(page), { timeout: drawTimeout })
    .toBeGreaterThan(100);
}

test("a picture from a trusted host is drawn behind the notes", async ({
  page,
}) => {
  await open(page, "url(https://example.test/dot.png)");
  await drawn(page);
});

test("the plain roll has no picture on it", async ({ page }) => {
  await open(page, null);
  expect(await reddest(page)).toBe(0);
});

test("a host the deployment does not trust is never even asked", async ({
  page,
}) => {
  const asked: string[] = [];
  page.on("request", (request) => asked.push(request.url()));
  await page.route("https://elsewhere.test/dot.png", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/png",
      headers: { "access-control-allow-origin": "*" },
      body: Buffer.from(redDot, "base64"),
    }),
  );
  await open(page, "url(https://elsewhere.test/dot.png)");
  // Nothing drawn is not enough on its own: the picture must never have been
  // fetched, which is the only thing that separates refused from broken.
  expect(
    asked.filter((url) => url.startsWith("https://elsewhere.test/")),
  ).toHaveLength(0);
  expect(await reddest(page)).toBe(0);
});

test("brightness darkens the picture that is drawn", async ({ page }) => {
  await open(page, "url(https://example.test/dot.png)");
  await drawn(page);
  const full = await reddest(page);
  await open(page, "url(https://example.test/dot.png) brightness(30%)");
  await expect
    .poll(async () => reddest(page), { timeout: drawTimeout })
    .toBeGreaterThan(0);
  expect(await reddest(page)).toBeLessThan(full);
});

test("a picture stays open to be shaped, and a shipped one is the whole choice", async ({
  page,
}) => {
  await open(page, null);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: /background/i }).click();
  const dialog = page.getByRole("dialog", { name: "Background" });
  await expect(dialog).toBeVisible();

  // A picture is only half the choice: brightness, tiling and travel are the
  // rest, so the dialog has to still be there to make them.
  await page.setInputFiles('input[aria-label="Background image"]', {
    name: "dot.png",
    mimeType: "image/png",
    buffer: Buffer.from(redDot, "base64"),
  });
  await expect(dialog).toBeVisible();

  const brightness = page.getByLabel("Background brightness percent");
  await expect(brightness).toBeVisible();
  await brightness.fill("40");
  await expect(dialog).toBeVisible();
  await page.getByRole("switch", { name: /^Travel with the notes/ }).click();
  await expect(dialog).toBeVisible();

  // Clicking away is how anyone who opened this to look gets out again.
  await page.mouse.click(8, 8);
  await expect(dialog).toHaveCount(0);

  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: /background/i }).click();
  await expect(dialog).toBeVisible();

  // A background this build ships needs nothing else said about it. The plain
  // roll is the one choice every machine can make: a shader background is
  // refused where there is no GPU to run it, which is every runner.
  await page.getByRole("button", { name: /^No background/ }).click();
  await expect(dialog).toHaveCount(0);
});

/** Red over black, so a shift shows up as a change in where the boundary sits
 * along a column. */
const striped =
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAQCAYAAAArij59AAAAGklEQVR4nGO4IyLyHx9mGCEKgOA/ATwSFAAAqtnAgXyUAVkAAAAASUVORK5CYII=";

async function serveStriped(page: Page): Promise<void> {
  await page.route("https://example.test/striped.png", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/png",
      headers: { "access-control-allow-origin": "*" },
      body: Buffer.from(striped, "base64"),
    }),
  );
}

/** Where the stripes sit down one column of the drawn picture, so a shift shows
 * as a different reading. */
async function column(page: Page): Promise<string> {
  return page.evaluate(() => {
    const canvas = [...document.querySelectorAll("canvas")].find(
      (found) => found.getAttribute("role") !== "img" && found.width > 400,
    );
    const ctx = canvas?.getContext("2d");
    if (canvas === undefined || ctx === null || ctx === undefined) {
      return "";
    }
    const data = ctx.getImageData(4, 0, 1, canvas.height).data;
    let out = "";
    for (let y = 0; y < canvas.height; y += 4) {
      out +=
        (data[y * 4 + 3] ?? 0) > 10 && (data[y * 4] ?? 0) > 128 ? "1" : "0";
    }
    return out;
  });
}

/** The column once two readings running agree on it, so a sample taken to be
 * compared against a later one is never a frame of travel behind. */
async function stillColumn(page: Page): Promise<string> {
  let last = await column(page);
  await expect
    .poll(
      async () => {
        const now = await column(page);
        const settled = now === last;
        last = now;
        return settled;
      },
      { timeout: drawTimeout },
    )
    .toBe(true);
  return last;
}

test("a travelling picture moves with the song and stops when it does", async ({
  page,
}) => {
  await seenTour(page);
  await serveFixture(page);
  await serveStriped(page);
  await page.goto(
    `/watch?${playerQuery()}&skin=${encodeURIComponent(
      "url(https://example.test/striped.png) scroll",
    )}`,
  );
  await page.locator("canvas").first().waitFor({ state: "visible" });
  await expect
    .poll(async () => column(page), { timeout: drawTimeout })
    .toContain("1");

  // Standing still before a note has been played.
  const before = await column(page);
  await page.waitForTimeout(1200);
  expect(await column(page)).toBe(before);

  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect
    .poll(async () => column(page), { timeout: drawTimeout })
    .not.toBe(before);

  await page.getByRole("button", { name: "Pause" }).click();
  const paused = await stillColumn(page);
  await page.waitForTimeout(1500);
  expect(await column(page)).toBe(paused);
});

test("the picture is shown as it will look, since the roll behind is blurred", async ({
  page,
}) => {
  await open(page, null);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: /background/i }).click();

  // Nothing to preview until there is a picture.
  await expect(page.getByText("How it will look")).toHaveCount(0);

  await page.locator('input[aria-label="Background image"]').setInputFiles({
    name: "shown.png",
    mimeType: "image/png",
    buffer: Buffer.from(redDot, "base64"),
  });
  await expect(page.getByText("How it will look")).toBeVisible();

  // The preview runs the picture itself, so its colour is on screen inside the
  // dialog rather than only behind it.
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]');
        for (const canvas of dialog?.querySelectorAll("canvas") ?? []) {
          const ctx = canvas.getContext("2d");
          if (ctx === null || canvas.width === 0) {
            continue;
          }
          const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          for (let i = 0; i < data.length; i += 4 * 37) {
            if (
              (data[i + 3] ?? 0) > 200 &&
              (data[i] ?? 0) > (data[i + 1] ?? 0) + 40
            ) {
              return true;
            }
          }
        }
        return false;
      }),
    )
    .toBe(true);
});

test("pictures pile up in a grid, and go from it", async ({ page }) => {
  await open(page, null);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: /background/i }).click();
  const file = page.locator('input[aria-label="Background image"]');

  for (const name of ["one.png", "two.png"]) {
    await file.setInputFiles({
      name,
      mimeType: "image/png",
      buffer: Buffer.from(redDot, "base64"),
    });
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  }

  // The one just added is the one being used.
  await expect(
    page.getByRole("button", { name: "two.png", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Remove one.png" }).click();
  await expect(
    page.getByRole("button", { name: "one.png", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "two.png", exact: true }),
  ).toBeVisible();

  // Removing the picture in use leaves the roll with nothing rather than a
  // background pointing at something that is gone.
  await page.getByRole("button", { name: "Remove two.png" }).click();
  await expect(
    page.getByRole("button", { name: "two.png", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Background brightness percent")).toHaveCount(0);
});

test("a picture survives the page being reloaded", async ({ page }) => {
  await open(page, null);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: /background/i }).click();
  await page.locator('input[aria-label="Background image"]').setInputFiles({
    name: "kept.png",
    mimeType: "image/png",
    buffer: Buffer.from(redDot, "base64"),
  });
  await expect(page.getByLabel("Background brightness percent")).toBeVisible();

  // A choice is written down a moment after the last change, and a link cannot
  // carry a picture held here, so the reload has only that write to read.
  await settingStored(page, "skin", "picture");
  await page.reload();
  await page.locator("canvas").first().waitFor({ state: "visible" });
  await drawn(page);
});

test.describe("with a system asking for less movement", () => {
  // The travel is the playhead's, so pausing stops it. That is the control such
  // a system is asking for, and it is why a picture is not held back here.
  test("a link's picture still travels with the song", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await seenTour(page);
    await serveFixture(page);
    await serveStriped(page);
    await page.goto(
      `/watch?${playerQuery()}&skin=${encodeURIComponent(
        "url(https://example.test/striped.png) scroll",
      )}`,
    );
    await page.locator("canvas").first().waitFor({ state: "visible" });
    await drawn(page);

    const before = await column(page);
    expect(before).not.toBe("");
    await page.waitForTimeout(1000);
    expect(await column(page)).toBe(before);

    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect
      .poll(async () => column(page), { timeout: drawTimeout })
      .not.toBe(before);
  });
});

test("a link naming a picture held on another device leaves the roll alone", async ({
  page,
}) => {
  const asked: string[] = [];
  page.on("request", (request) => asked.push(request.url()));
  await open(page, "url(local:25b96c50-9bc4-47da-a25e-53fb4392eb98)");
  expect(await reddest(page)).toBe(0);
  expect(asked.filter((url) => url.startsWith("local:"))).toHaveLength(0);
});
