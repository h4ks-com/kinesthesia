import { expect, test } from "@playwright/test";
import { Midi } from "@tonejs/midi";
import { seenTour } from "./fixture";

/** Major chords then minor ones, so the meadow has something to answer to. */
function chordSong(): Uint8Array {
  const midi = new Midi();
  const track = midi.addTrack();
  let at = 2;
  for (let bar = 0; bar < 6; bar += 1) {
    for (const pitch of [60, 64, 67]) {
      track.addNote({ midi: pitch, time: at, duration: 0.9, velocity: 0.8 });
    }
    at += 1;
  }
  for (let bar = 0; bar < 6; bar += 1) {
    for (const pitch of [57, 60, 64]) {
      track.addNote({ midi: pitch, time: at, duration: 0.9, velocity: 0.8 });
    }
    at += 1;
  }
  return new Uint8Array(midi.toArray());
}

test("the flower meadow colours on major and fades on minor", async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text().slice(0, 200));
  });
  await seenTour(page);
  await page.route("https://example.test/chords.mid", (route) =>
    route.fulfill({
      status: 200,
      contentType: "audio/midi",
      headers: { "access-control-allow-origin": "*" },
      body: Buffer.from(chordSong()),
    }),
  );
  await page.goto(
    `/watch?url=${encodeURIComponent("https://example.test/chords.mid")}&name=Chords&skin=flower`,
  );
  await page.locator("canvas").first().waitFor({ state: "visible" });
  await page.waitForTimeout(1200);

  /** How much colour the background layer carries, and how bright it gets. */
  const read = async () =>
    page.evaluate(() => {
      const layers = [...document.querySelectorAll("canvas")].filter(
        (x) => x.getAttribute("role") !== "img",
      );
      let colour = 0;
      let brightest = 0;
      let luma = 0;
      let lit = 0;
      for (const c of layers) {
        const ctx = c.getContext("2d");
        if (ctx === null || c.width === 0) continue;
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        for (let i = 0; i < d.length; i += 4 * 97) {
          const r = d[i] ?? 0;
          const g = d[i + 1] ?? 0;
          const b = d[i + 2] ?? 0;
          const a = d[i + 3] ?? 0;
          if (a < 8) continue;
          lit += 1;
          colour += Math.max(r, g, b) - Math.min(r, g, b);
          brightest = Math.max(brightest, Math.max(r, g, b));
          luma += 0.299 * r + 0.587 * g + 0.114 * b;
        }
      }
      return {
        colour,
        brightest,
        lit,
        // Mean perceived brightness of what was drawn. Saturating a colour at a
        // fixed lightness raises its strongest channel without making it any
        // brighter to look at, so this is what "not brighter" has to mean.
        luma: lit === 0 ? 0 : Math.round(luma / lit),
        layers: layers.length,
      };
    });

  /** Where the song has got to, which is what the meadow answers. A run under
   * load plays behind the wall clock, so sleeping for six seconds can read the
   * major bars while the song is still on the runway. */
  const reached = async (seconds: number): Promise<void> => {
    await expect
      .poll(
        async () => {
          const shown = await page.locator("footer span").first().textContent();
          const [minutes, secs] = (shown ?? "0:00")
            .split(" ")[0]
            ?.split(":") ?? ["0", "0"];
          return Number(minutes) * 60 + Number(secs);
        },
        { timeout: 60000, intervals: [250] },
      )
      .toBeGreaterThanOrEqual(seconds);
  };

  const atRest = await read();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  // Six bars of C major run from the second second, so this lands inside them.
  await reached(7);
  const afterMajor = await read();

  // The song turns minor halfway through, and the meadow should fall back. Read
  // well after the turn, since the meadow drains slower than it fills.
  await reached(13);
  const afterMinor = await read();
  console.log(
    `### rest=${JSON.stringify(atRest)} afterMajor=${JSON.stringify(afterMajor)} afterMinor=${JSON.stringify(afterMinor)}`,
  );
  console.log(`### errors=${JSON.stringify(errors.slice(0, 2))}`);
  expect(errors).toHaveLength(0);
  // Grey to begin with, colour once the major chords have gone by.
  expect(afterMajor.colour).toBeGreaterThan(atRest.colour);
  // And never bright enough to compete with the notes in front of it.
  expect(afterMajor.brightest).toBeLessThan(200);
  // It answers in colour, not in light: a meadow that simply got brighter as
  // the music turned would be competing with the notes rather than sitting
  // behind them.
  expect(afterMajor.luma - atRest.luma).toBeLessThan(30);
  // And falls back once the music turns, rather than only ever climbing.
  expect(afterMinor.colour).toBeLessThan(afterMajor.colour);
});
