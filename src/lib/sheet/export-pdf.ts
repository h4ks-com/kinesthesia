import { downloadBlob, downloadName } from "@/lib/download";
import { osmdPxPerUnit } from "@/lib/sheet/marks";
import type { SheetMusic } from "@/lib/sheet/types";

const mmToPx = 96 / 25.4;

/** 9x12in, the concert page published piano and instrumental sheet music
 * ships at (Henle and Schirmer both use it; MOLA's guideline for parts runs
 * 9x12in to 11x14in). Whole millimetres, which is all `setPageFormat` reads. */
export const pageWidthMm = 229;
export const pageHeightMm = 305;

/** Behind Bars' own minimum border, and MuseScore and LilyPond's shared
 * default whatever the page size. */
const marginMm = 15;

/** OSMD measures its page margins in its own units, one staff line spacing
 * each. */
const marginUnits = (marginMm * mmToPx) / osmdPxPerUnit;

/** OSMD's default staff is four of its own units tall (see
 * `EngravingRules.d.ts`), which prints far taller than any engraver's rastral
 * until the zoom brings it down. */
const staffHeightUnits = 4;
const nativeStaffHeightMm = (staffHeightUnits * osmdPxPerUnit) / mmToPx;

/** A printed piano edition fits four or so bars to a system and five or six
 * systems to a page. */
const soloStaffHeightMm = 4.6;

/** Smaller again for a score of several instruments stacking several staves in
 * one system, the way a conductor's score does. */
const ensembleStaffHeightMm = 3.4;

/** How much room each voice entry claims along a staff. OSMD's defaults (0.85
 * and 3.0) space a screen; an engraved bar packs tighter than that. */
const voiceSpacingMultiplier = 0.6;
const voiceSpacingAddend = 1.6;

function zoomForStaffHeight(staffHeightMm: number): number {
  return staffHeightMm / nativeStaffHeightMm;
}

/** A piano or other solo line reads at a full engraver's staff height; a score
 * of several instruments shrinks to fit them stacked in one system. Matches
 * the threshold the panel already uses to decide whether a part needs naming. */
export function engravingZoom(partCount: number): number {
  return zoomForStaffHeight(
    partCount > 1 ? ensembleStaffHeightMm : soloStaffHeightMm,
  );
}

export function sheetPdfFileName(title: string): string {
  return downloadName(title, "pdf");
}

export type EngravedPages = {
  readonly host: HTMLDivElement;
  readonly pages: readonly SVGSVGElement[];
};

/**
 * Engraves the score as pages, one SVG each.
 *
 * OSMD paginates a score itself once it is given a page format, breaking
 * between systems and drawing every page whole. Engraving one tall score and
 * cutting it into pages instead puts the cut where the arithmetic lands rather
 * than where the music allows, and clips whatever straddles it.
 *
 * The caller owns the host and must remove it.
 */
export async function engravePages(sheet: SheetMusic): Promise<EngravedPages> {
  const { OpenSheetMusicDisplay } = await import("opensheetmusicdisplay");
  const host = document.createElement("div");
  host.style.position = "absolute";
  host.style.left = "-99999px";
  host.style.top = "0";
  host.style.width = `${pageWidthMm * mmToPx}px`;
  document.body.appendChild(host);
  try {
    const osmd = new OpenSheetMusicDisplay(host, {
      backend: "svg",
      drawTitle: true,
      drawPartNames: sheet.partNames.length > 1,
      drawComposer: false,
      followCursor: false,
      autoResize: false,
      defaultColorMusic: "#000000",
    });
    osmd.setPageFormat(`${pageWidthMm}x${pageHeightMm}`);
    const rules = osmd.EngravingRules;
    rules.PageLeftMargin = marginUnits;
    rules.PageRightMargin = marginUnits;
    rules.PageTopMargin = marginUnits;
    rules.PageBottomMargin = marginUnits;
    rules.VoiceSpacingMultiplierVexflow = voiceSpacingMultiplier;
    rules.VoiceSpacingAddendVexflow = voiceSpacingAddend;
    osmd.zoom = engravingZoom(sheet.partNames.length);
    await osmd.load(sheet.musicXml);
    osmd.render();

    const pages = [...host.querySelectorAll("svg")];
    if (pages.length === 0) {
      throw new Error("This song's notation could not be printed.");
    }
    return { host, pages };
  } catch (error) {
    host.remove();
    throw error;
  }
}

export async function downloadSheetPdf(
  sheet: SheetMusic,
  title: string,
): Promise<void> {
  const { jsPDF } = await import("jspdf");
  await import("svg2pdf.js");

  const { host, pages } = await engravePages(sheet);
  try {
    const doc = new jsPDF({
      orientation: "p",
      unit: "mm",
      format: [pageWidthMm, pageHeightMm],
      compress: true,
    });
    for (let index = 0; index < pages.length; index += 1) {
      const page = pages[index];
      if (page === undefined) {
        continue;
      }
      if (index > 0) {
        doc.addPage([pageWidthMm, pageHeightMm], "p");
      }
      await doc.svg(page, {
        x: 0,
        y: 0,
        width: pageWidthMm,
        height: pageHeightMm,
      });
    }
    downloadBlob(doc.output("blob"), sheetPdfFileName(title));
  } finally {
    host.remove();
  }
}
