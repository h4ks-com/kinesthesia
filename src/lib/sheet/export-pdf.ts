import type { OpenSheetMusicDisplay } from "opensheetmusicdisplay";
import { downloadBlob, downloadName } from "@/lib/download";
import type { SheetMusic } from "@/lib/sheet/types";

const mmToPt = 72 / 25.4;
const mmToPx = 96 / 25.4;

/** 9x12in, the concert/octavo page published piano and instrumental sheet
 * music actually ships at (Henle, Schirmer both use it; MOLA's own guideline
 * for parts runs 9x12in to 11x14in), roomier in both directions than A4. */
const pageWidthMm = 9 * 25.4;
const pageHeightMm = 12 * 25.4;

/** Behind Bars' own minimum border, and MuseScore and LilyPond's shared
 * default regardless of page size. */
const marginMm = 15;

const contentWidthMm = pageWidthMm - 2 * marginMm;
const contentHeightMm = pageHeightMm - 2 * marginMm;

/** A little above the measure number OSMD draws just above the following
 * system's staff, in the same native pixels as everything else this module
 * reads off the live SVG, so that number never bleeds onto the page above it. */
const labelClearancePx = 30;

export const pageWidthPt = pageWidthMm * mmToPt;
export const pageHeightPt = pageHeightMm * mmToPt;
export const marginPt = marginMm * mmToPt;
export const contentWidthPt = contentWidthMm * mmToPt;
export const contentHeightPt = contentHeightMm * mmToPt;

/** The container OSMD engraves into has to be as wide, in CSS pixels, as the
 * page's printable width really is: OSMD wraps measures into systems by that
 * pixel count, at the 96 CSS-px-per-inch its own unit system assumes. Feeding
 * it `contentWidthPt`'s number directly, as the screen panel's own container
 * width does, silently starves it to a third less width than the page really
 * has, and is the reason a page held only a few bars. Its height counterpart
 * paginates the score by the same native pixels the live SVG is measured in. */
export const engraveWidthPx = contentWidthMm * mmToPx;
export const engraveHeightPx = contentHeightMm * mmToPx;

/** Browsers draw OSMD's SVG at 96 CSS px per inch; a PDF page places content
 * in 72pt-per-inch points. Every native pixel read off the live SVG (widths,
 * heights, system tops) needs this same factor to land at the right physical
 * size on the page, the conversion the engraving width above already applies
 * in the other direction. */
const pxToPt = 72 / 96;

/** OSMD's own unit is one staff-line spacing: 10 CSS px in its Vexflow
 * backend at zoom 1, and its default staff is 4 units tall (see
 * `EngravingRules.d.ts`). That is the real millimetre height a staff prints
 * at when zoom is left at its default of 1, which is larger than any
 * engraver's print rastral, and is the other reason a page held so few bars:
 * every measure was drawn nearly 50% wider than a printed one would be. */
const osmdUnitPxAtZoom1 = 10;
const staffHeightUnits = 4;
const nativeStaffHeightMm = (staffHeightUnits * osmdUnitPxAtZoom1) / mmToPx;

/** MuseScore and LilyPond's shared default staff height for a solo or piano
 * score, in engravers' cited sweet spot for readable print (6.5-7.5mm). */
const soloStaffHeightMm = 7;

/** Smaller, for a score of several instruments stacking several staves in
 * one system: still well above a conductor's full-score floor of about 4mm. */
const ensembleStaffHeightMm = 5;

function zoomForStaffHeight(staffHeightMm: number): number {
  return staffHeightMm / nativeStaffHeightMm;
}

/** A piano or other solo line reads best at a full engraver's staff height; a
 * score of several instruments has to shrink to fit more than one stacked in
 * a system, the way a real ensemble score does. Matches the same threshold
 * the panel and this module already use to decide whether a part's name
 * needs printing at all. */
export function engravingZoom(partCount: number): number {
  return zoomForStaffHeight(
    partCount > 1 ? ensembleStaffHeightMm : soloStaffHeightMm,
  );
}

export type PageSlice = {
  readonly top: number;
  readonly height: number;
};

/** The latest point in `points` that still keeps every page under `pageHeight`,
 * walked one page at a time. A single interval taller than a page still gets a
 * page of its own rather than looping forever. */
function pageStarts(points: readonly number[], pageHeight: number): number[] {
  const starts: number[] = [points[0] ?? 0];
  let anchor = starts[0] ?? 0;
  let index = 1;
  while (index < points.length) {
    const point = points[index] ?? anchor;
    if (point - anchor <= pageHeight) {
      index += 1;
      continue;
    }
    const previous = points[index - 1] ?? anchor;
    anchor = previous > anchor ? previous : point;
    starts.push(anchor);
    if (anchor === point) {
      index += 1;
    }
  }
  return starts;
}

/** Where each printed page starts and how tall it is, given the top of every
 * system in the whole engraved score. A page never starts inside a system:
 * each break sits at the latest system top that still leaves the page under
 * budget, and the leading page always starts at 0 so the title prints on it. */
export function paginateSystems(
  systemTops: readonly number[],
  totalHeight: number,
  pageHeight: number,
  labelClearance = labelClearancePx,
): readonly PageSlice[] {
  // `totalHeight` rides along as a candidate too, so a break can still land
  // before the score's own end when the last few systems alone overflow a
  // page; it is never itself a page's start, so it is dropped back off after.
  const candidates = pageStarts([0, ...systemTops, totalHeight], pageHeight);
  const starts =
    candidates.length > 1 && candidates[candidates.length - 1] === totalHeight
      ? candidates.slice(0, -1)
      : candidates;
  // Every break above already keeps a page's span at or under `pageHeight`,
  // except the one system too tall for any page to hold, which stays whole
  // rather than clamped and cut.
  return starts.map((top, index) => {
    const next = starts[index + 1];
    const height =
      next === undefined ? totalHeight - top : next - top - labelClearance;
    return { top, height };
  });
}

export function sheetPdfFileName(title: string): string {
  return downloadName(title, "pdf");
}

/** Walks the cursor over the whole score once to read where every system
 * starts, the same technique the video render's off-screen engrave uses to
 * mark note positions, but to the iterator's own end rather than a fixed
 * onset count: a trailing rest measure with no onset of its own still takes
 * up a system, and still has to land on some page. Deduped and sorted, since
 * every onset in one system shares its top. */
export function readSystemTops(osmd: OpenSheetMusicDisplay): number[] {
  osmd.cursor.show();
  osmd.cursor.reset();
  const tops = new Set<number>();
  while (true) {
    tops.add(Number.parseFloat(osmd.cursor.cursorElement.style.top) || 0);
    if (osmd.cursor.iterator.EndReached) {
      break;
    }
    osmd.cursor.next();
  }
  return [...tops].sort((left, right) => left - right);
}

/** Drops every top-level element the clone carries from the rest of the
 * score once its own viewBox is cropped to one page's slice: the clone still
 * carries the whole score's paths underneath that crop, so left alone, every
 * page's PDF content would embed the entire score once per page. */
function pruneOutsideSlice(svg: SVGSVGElement, slice: PageSlice): void {
  const bottom = slice.top + slice.height;
  for (const child of [...svg.children]) {
    if (!(child instanceof SVGGraphicsElement)) {
      continue;
    }
    const box = child.getBBox();
    if (box.y + box.height < slice.top || box.y > bottom) {
      child.remove();
    }
  }
}

/** Engraves the whole score off screen at print size, black ink on white
 * paper, and downloads it as a paginated PDF: the notation as written, with no
 * playback cursor on it. Throws if the score could not be engraved at all. */
export async function downloadSheetPdf(
  sheet: SheetMusic,
  title: string,
): Promise<void> {
  const { OpenSheetMusicDisplay, CursorType } = await import(
    "opensheetmusicdisplay"
  );
  const { jsPDF } = await import("jspdf");
  await import("svg2pdf.js");

  const host = document.createElement("div");
  host.style.position = "absolute";
  host.style.left = "-99999px";
  host.style.top = "0";
  host.style.width = `${engraveWidthPx}px`;
  document.body.appendChild(host);
  try {
    const osmd = new OpenSheetMusicDisplay(host, {
      backend: "svg",
      drawTitle: true,
      drawPartNames: sheet.partNames.length > 1,
      drawComposer: false,
      followCursor: false,
      defaultColorMusic: "#000000",
      cursorsOptions: [
        {
          type: CursorType.Standard,
          color: "#000000",
          alpha: 0,
          follow: false,
        },
      ],
    });
    osmd.zoom = engravingZoom(sheet.partNames.length);
    await osmd.load(sheet.musicXml);
    osmd.render();

    const svg = host.querySelector("svg");
    if (svg === null) {
      throw new Error("This song's notation could not be printed.");
    }
    const totalHeight = Number.parseFloat(svg.getAttribute("height") ?? "0");
    const systemTops = readSystemTops(osmd);
    const pages = paginateSystems(systemTops, totalHeight, engraveHeightPx);

    const doc = new jsPDF({
      orientation: "p",
      unit: "pt",
      format: [pageWidthPt, pageHeightPt],
      compress: true,
    });
    for (let index = 0; index < pages.length; index += 1) {
      const slice = pages[index];
      if (slice === undefined) {
        continue;
      }
      if (index > 0) {
        doc.addPage([pageWidthPt, pageHeightPt], "p");
      }
      const heightPt = slice.height * pxToPt;
      const clone = svg.cloneNode(true) as SVGSVGElement;
      clone.setAttribute("width", String(contentWidthPt));
      clone.setAttribute("height", String(heightPt));
      clone.setAttribute(
        "viewBox",
        `0 ${slice.top} ${engraveWidthPx} ${slice.height}`,
      );
      host.appendChild(clone);
      try {
        pruneOutsideSlice(clone, slice);
        await doc.svg(clone, {
          x: marginPt,
          y: marginPt,
          width: contentWidthPt,
          height: heightPt,
        });
      } finally {
        clone.remove();
      }
    }

    downloadBlob(doc.output("blob"), sheetPdfFileName(title));
  } finally {
    host.remove();
  }
}
