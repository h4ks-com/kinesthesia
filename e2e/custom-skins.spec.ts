import { expect, test } from "@playwright/test";
import { playerQuery, seenTour, serveFixture } from "./fixture";

/** A background small enough to read, that paints something unmistakable. */
const script = `
background({
  name: "Test Meadow",
  blurb: "A flat magenta wash, so a test can see it arrived.",
  create() {
    return {
      paint(ctx, view, frame) {
        ctx.fillStyle = "rgb(220,0,180)";
        ctx.fillRect(0, 0, view.width, view.height);
      },
    };
  },
});
`;

test("the listing is open to read and shut to write", async ({ request }) => {
  test.setTimeout(120000);

  // Anyone may read it, since choosing a background needs no account.
  const before = await request.get("/api/skins");
  expect(before.ok()).toBe(true);
  const listed = await before.json();
  expect(listed.builtIn.length).toBeGreaterThanOrEqual(9);
  expect(Array.isArray(listed.custom)).toBe(true);

  // Writing takes the token. A run has none, so this covers the outer gate
  // only; that a good script is kept and a bad one refused is covered by the
  // unit tests around the parser and by hand against a browser.
  for (const answer of [
    await request.post("/api/skins", { data: { source: script } }),
    await request.delete("/api/skins/3f1c1f0a-1111-4222-8333-444455556666"),
  ]) {
    expect(answer.status()).toBe(401);
  }
});

test("the plain roll still works and every built-in is still listed", async ({
  page,
  request,
}) => {
  const listing = await (await request.get("/api/skins")).json();
  const ids = listing.builtIn.map((s: { id: string }) => s.id);
  for (const id of [
    "starfield",
    "cruise",
    "aurora",
    "rainfall",
    "abyss",
    "horizon",
    "ember",
    "ink",
    "flower",
  ]) {
    expect(ids).toContain(id);
  }
  // A shipped background is not stored anywhere to remove from, so its id is
  // not one this route will act on however the caller arrives.
  const gone = await request.delete(`/api/skins/ink`);
  expect(gone.ok()).toBe(false);

  await seenTour(page);
  await serveFixture(page);
  await page.goto(`/watch?${playerQuery()}`);
  await page.locator("canvas").first().waitFor({ state: "visible" });
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeVisible();
});
