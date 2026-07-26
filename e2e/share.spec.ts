import { expect, test } from "@playwright/test";
import { Midi } from "@tonejs/midi";
import { seenTour } from "./fixture";

type Page = import("@playwright/test").Page;

const publicUrl = "https://files.test/shared/abc.mid";

function midiBytes(): Uint8Array {
  const midi = new Midi();
  const track = midi.addTrack();
  for (let bar = 0; bar < 4; bar += 1) {
    track.addNote({ midi: 60 + bar, time: bar * 0.5, duration: 0.4 });
  }
  return new Uint8Array(midi.toArray());
}

/** Answers the publish call without a bucket or a session behind it, so the
 * page's own behaviour is what is under test. */
async function serverAccepts(page: Page): Promise<void> {
  await page.route("**/api/uploads", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ url: publicUrl }),
    }),
  );
}

async function addFile(page: Page): Promise<void> {
  await page.setInputFiles('input[type="file"]', {
    name: "mine.mid",
    mimeType: "audio/midi",
    buffer: Buffer.from(midiBytes()),
  });
  // Dropping one file opens it, so come back to the list it was filed in.
  await page.waitForURL(/\/watch\?/);
  await page.goBack();
  await expect(page.getByText("mine.mid").first()).toBeVisible();
}

async function openHome(page: Page): Promise<void> {
  await seenTour(page);
  await serverAccepts(page);
  await page.goto("/");
}

test("a file kept on this device offers no link until it is shared", async ({
  page,
}) => {
  await openHome(page);
  await addFile(page);

  // Signed out, the offer is visible but closed, and says what would open it.
  const offer = page.getByRole("button", { name: /Sign in to share mine.mid/ });
  await expect(offer).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Share mine.mid/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Copy the link to mine.mid/ }),
  ).toHaveCount(0);
});
