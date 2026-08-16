import type { OpenSheetMusicDisplay } from "opensheetmusicdisplay";
import { downloadBlob, downloadName } from "@/lib/download";
import type { SheetMusic } from "@/lib/sheet/types";

const mmToPt = 72 / 25.4;
const pageWidthMm = 210;
const pageHeightMm = 297;
const marginMm = 15;

/** A little above the measure number OSMD draws just above the following
 * system's staff, so that number never bleeds onto the page above it. */
const labelClearancePt = 30;

export const pageWidthPt = pageWidthMm * mmToPt;
export const pageHeightPt = pageHeightMm * mmToPt;
export const marginPt = marginMm * mmToPt;
export const contentWidthPt = pageWidthPt - 2 * marginPt;
export const contentHeightPt = pageHeightPt - 2 * marginPt;

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
  labelClearance = labelClearancePt,
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
function readSystemTops(osmd: OpenSheetMusicDisplay): number[] {
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
  host.style.width = `${contentWidthPt}px`;
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
    await osmd.load(sheet.musicXml);
    osmd.render();

    const svg = host.querySelector("svg");
    if (svg === null) {
      throw new Error("This song's notation could not be printed.");
    }
    const totalHeight = Number.parseFloat(svg.getAttribute("height") ?? "0");
    const systemTops = readSystemTops(osmd);
    const pages = paginateSystems(systemTops, totalHeight, contentHeightPt);

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
      const clone = svg.cloneNode(true) as SVGSVGElement;
      clone.setAttribute("width", String(contentWidthPt));
      clone.setAttribute("height", String(slice.height));
      clone.setAttribute(
        "viewBox",
        `0 ${slice.top} ${contentWidthPt} ${slice.height}`,
      );
      host.appendChild(clone);
      try {
        pruneOutsideSlice(clone, slice);
        await doc.svg(clone, {
          x: marginPt,
          y: marginPt,
          width: contentWidthPt,
          height: slice.height,
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
