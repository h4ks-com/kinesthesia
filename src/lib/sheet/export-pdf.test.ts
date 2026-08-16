import { describe, expect, it } from "vitest";
import {
  contentHeightPt,
  contentWidthPt,
  pageHeightPt,
  pageWidthPt,
  paginateSystems,
  sheetPdfFileName,
} from "@/lib/sheet/export-pdf";

describe("page size", () => {
  it("is A4 portrait in points", () => {
    expect(pageWidthPt).toBeCloseTo(595.28, 1);
    expect(pageHeightPt).toBeCloseTo(841.89, 1);
  });

  it("leaves an equal margin on every side of the content", () => {
    expect(contentWidthPt).toBeLessThan(pageWidthPt);
    expect(contentHeightPt).toBeLessThan(pageHeightPt);
    expect(pageWidthPt - contentWidthPt).toBeCloseTo(
      pageHeightPt - contentHeightPt,
      5,
    );
  });
});

describe("paginateSystems", () => {
  it("puts everything on one page when it all fits", () => {
    expect(paginateSystems([100, 200], 300, 1000)).toEqual([
      { top: 0, height: 300 },
    ]);
  });

  it("breaks between systems rather than through one", () => {
    const pages = paginateSystems([100, 200, 300, 400], 500, 250);
    expect(pages).toEqual([
      { top: 0, height: 170 },
      { top: 200, height: 170 },
      { top: 400, height: 100 },
    ]);
    for (const page of pages) {
      expect(page.height).toBeLessThanOrEqual(250);
    }
  });

  it("starts the first page at 0 so the title prints on it", () => {
    const pages = paginateSystems([50, 900], 1000, 400);
    expect(pages[0]?.top).toBe(0);
  });

  it("gives a system too tall for any page its own page, uncut", () => {
    const pages = paginateSystems([900], 1000, 400);
    expect(pages.map((page) => page.top)).toEqual([0, 900]);
    // The oversized system's own page overflows the budget rather than
    // clipping the system to fit it.
    expect(pages[0]?.height).toBe(870);
  });

  it("trims a clearance off every page but the last", () => {
    expect(paginateSystems([100, 250], 300, 240, 10)).toEqual([
      { top: 0, height: 90 },
      { top: 100, height: 200 },
    ]);
  });

  it("needs as many pages as a score of this height does", () => {
    const systemTops = Array.from(
      { length: 20 },
      (_, index) => (index + 1) * 100,
    );
    const pages = paginateSystems(systemTops, 2100, 450);
    expect(pages.length).toBe(6);
    for (const page of pages.slice(0, -1)) {
      expect(page.height).toBeLessThanOrEqual(450);
    }
  });

  it("copes with a score that has nothing written on it", () => {
    expect(paginateSystems([], 40, 400)).toEqual([{ top: 0, height: 40 }]);
  });
});

describe("sheetPdfFileName", () => {
  it("names the file after the song, as a pdf", () => {
    expect(sheetPdfFileName("Clair de Lune")).toBe("Clair_de_Lune.pdf");
  });

  it("falls back to a plain name when the title has nothing usable", () => {
    expect(sheetPdfFileName("***")).toBe("song.pdf");
  });
});
