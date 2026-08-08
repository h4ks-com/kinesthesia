import { expect, test } from "@playwright/test";
import { Midi } from "@tonejs/midi";
import { seenTour, serveMidi } from "./fixture";

type Page = import("@playwright/test").Page;

const remoteUrl = "https://example.test/opened.mid";

function midiBytes(): Uint8Array {
  const midi = new Midi();
  const track = midi.addTrack();
  for (let bar = 0; bar < 4; bar += 1) {
    track.addNote({ midi: 60 + bar, time: bar * 0.5, duration: 0.4 });
  }
  return new Uint8Array(midi.toArray());
}

async function openHome(page: Page): Promise<void> {
  await seenTour(page);
  await serveMidi(page, remoteUrl, midiBytes());
  await page.goto("/");
}

const search = "Search for a song, or paste a link";

test("dropping a single file opens it instead of only filing it away", async ({
  page,
}) => {
  await openHome(page);
  await page.setInputFiles('input[type="file"]', {
    name: "dropped.mid",
    mimeType: "audio/midi",
    buffer: Buffer.from(midiBytes()),
  });
  await page.waitForURL(/\/watch\?/);
  await expect(page.locator("canvas")).toBeVisible();
  expect(page.url()).toContain("dropped.mid");
});

test("several files at once stay on the page, since that is a library import", async ({
  page,
}) => {
  await openHome(page);
  await page.setInputFiles('input[type="file"]', [
    {
      name: "one.mid",
      mimeType: "audio/midi",
      buffer: Buffer.from(midiBytes()),
    },
    {
      name: "two.mid",
      mimeType: "audio/midi",
      buffer: Buffer.from(midiBytes()),
    },
  ]);
  await expect(page.getByText("one.mid").first()).toBeVisible();
  expect(page.url()).not.toContain("/watch");
});

test("pasting a link opens it", async ({ page }) => {
  await openHome(page);
  const box = page.getByLabel(search);
  await box.click();
  // A paste carries the whole address at once, which is the signal that the
  // link is finished and meant to be played.
  await box.evaluate((element, url) => {
    const data = new DataTransfer();
    data.setData("text", url);
    // Firefox drops clipboardData handed to the constructor, so it is attached
    // to the event instead, which every engine reads back.
    const event = new ClipboardEvent("paste", { bubbles: true });
    Object.defineProperty(event, "clipboardData", { value: data });
    element.dispatchEvent(event);
  }, remoteUrl);
  await page.waitForURL(/\/watch\?/);
  await expect(page.locator("canvas")).toBeVisible();
});

test("pressing enter on a typed link opens it", async ({ page }) => {
  await openHome(page);
  await page.getByLabel(search).fill(remoteUrl);
  await page.getByLabel(search).press("Enter");
  await page.waitForURL(/\/watch\?/);
  await expect(page.locator("canvas")).toBeVisible();
});

test("typing a song name still searches rather than opening anything", async ({
  page,
}) => {
  await openHome(page);
  // The search going out is what says the name was read as a name, and it is a
  // firmer thing to wait on than a span of time.
  const searched = page.waitForRequest(/\/api\/midi\/search\?/);
  await page.getByLabel(search).fill("moonlight");
  await page.getByLabel(search).press("Enter");
  await searched;
  expect(page.url()).not.toContain("/watch");
});
