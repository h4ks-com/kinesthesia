import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { Midi } from "@tonejs/midi";

/** `src/lib/sheet/export-pdf.ts` is a pure module with no button wired to it
 * yet, so this bundles it (and the small harness that feeds it a `SheetMusic`
 * built from real bytes) into one browser-ready script and runs that in a
 * real page, the only way to exercise it end to end without one. */
let harnessSource: string;

test.beforeAll(() => {
  const outDir = mkdtempSync(path.join(tmpdir(), "sheet-pdf-export-"));
  const outFile = path.join(outDir, "harness.js");
  execFileSync("bun", [
    "build",
    path.join(__dirname, "fixtures/pdf-export-harness.ts"),
    "--outfile",
    outFile,
    "--format=iife",
    "--target=browser",
  ]);
  harnessSource = readFileSync(outFile, "utf8");
});

function shortMidi(): Uint8Array {
  const midi = new Midi();
  const track = midi.addTrack();
  track.addNote({ midi: 60, time: 0, duration: 1 });
  track.addNote({ midi: 64, time: 1, duration: 1 });
  return new Uint8Array(midi.toArray());
}

/** Long enough that no reasonable page count could hold it on one page: a
 * few minutes of a full-range melody plus a held chord underneath. */
function longMidi(): Uint8Array {
  const midi = new Midi();
  const melody = midi.addTrack();
  const chords = midi.addTrack();
  const pitches = [60, 62, 64, 65, 67, 69, 71, 72];
  for (let measure = 0; measure < 80; measure += 1) {
    for (let step = 0; step < 4; step += 1) {
      melody.addNote({
        midi: pitches[(measure + step) % pitches.length] ?? 60,
        time: measure * 2 + step * 0.5,
        duration: 0.5,
      });
    }
    chords.addNote({
      midi: 36 + (measure % 12),
      time: measure * 2,
      duration: 1.8,
    });
  }
  return new Uint8Array(midi.toArray());
}

async function exportPdf(page: Page, bytes: Uint8Array, name: string) {
  await page.goto("about:blank");
  await page.addScriptTag({ content: harnessSource });
  const download = page.waitForEvent("download", { timeout: 30000 });
  const base64 = Buffer.from(bytes).toString("base64");
  await page.evaluate(
    async ({ base64, name }) => {
      const binary = atob(base64);
      const raw = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        raw[index] = binary.charCodeAt(index);
      }
      await window.exportSheetPdf(raw.buffer, name);
    },
    { base64, name },
  );
  return download;
}

function countPages(bytes: Buffer): number {
  const text = bytes.toString("latin1");
  const matches = text.match(/\/Type\s*\/Page[^s]/g);
  return matches?.length ?? 0;
}

test("a short song comes back as a one page pdf", async ({ page }) => {
  const download = await exportPdf(page, shortMidi(), "Two Notes");
  const filePath = await download.path();
  expect(filePath).not.toBeNull();
  expect(download.suggestedFilename()).toBe("Two_Notes.pdf");

  const bytes = readFileSync(filePath as string);
  expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  expect(countPages(bytes)).toBe(1);
});

test("a long song is split across several pages, none of them empty", async ({
  page,
}) => {
  test.setTimeout(60000);
  const download = await exportPdf(page, longMidi(), "Long Song");
  const filePath = await download.path();
  expect(filePath).not.toBeNull();

  const bytes = readFileSync(filePath as string);
  expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  const pages = countPages(bytes);
  expect(pages).toBeGreaterThan(3);
  // A real page of engraved notation, not a handful of empty ones padded on.
  expect(bytes.byteLength / pages).toBeGreaterThan(20_000);
});
