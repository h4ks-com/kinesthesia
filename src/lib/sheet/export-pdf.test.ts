import { describe, expect, it } from "vitest";
import {
  engravingZoom,
  pageHeightMm,
  pageWidthMm,
  sheetPdfFileName,
} from "@/lib/sheet/export-pdf";

describe("the printed page", () => {
  it("is the concert size published music ships at, in portrait", () => {
    // 9x12in to the millimetre.
    expect(pageWidthMm).toBe(229);
    expect(pageHeightMm).toBe(305);
    expect(pageHeightMm).toBeGreaterThan(pageWidthMm);
  });
});

describe("engravingZoom", () => {
  it("prints a staff at an engraver's rastral rather than a screen's", () => {
    // OSMD draws a staff about 10.6mm tall at zoom 1; print wants a fraction
    // of that, or a page holds a couple of bars.
    expect(engravingZoom(1)).toBeLessThan(0.6);
    expect(engravingZoom(1)).toBeGreaterThan(0.2);
  });

  it("shrinks a score of several instruments to fit them stacked", () => {
    expect(engravingZoom(8)).toBeLessThan(engravingZoom(1));
  });
});

describe("sheetPdfFileName", () => {
  it("names the file after the song", () => {
    expect(sheetPdfFileName("Clair de Lune")).toBe("Clair_de_Lune.pdf");
  });

  it("falls back rather than producing a nameless file", () => {
    expect(sheetPdfFileName("")).toBe("song.pdf");
  });
});
