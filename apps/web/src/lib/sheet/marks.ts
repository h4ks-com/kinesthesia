import type {
  GraphicalStaffEntry,
  OpenSheetMusicDisplay,
} from "opensheetmusicdisplay";
import { divisions } from "@/lib/sheet/notation";
import type { WrittenNote } from "@/lib/sheet/types";

/** A written note's box on the engraved page, in the host's own pixel space:
 * the same coordinates OSMD's own cursor images are placed and sized in
 * (`left`/`top` in CSS pixels, `height` the image's `height` attribute), so a
 * mark drawn from this sits exactly where OSMD would have put its cursor. */
export type ScoreMark = {
  readonly left: number;
  readonly top: number;
  readonly height: number;
};

/** OSMD's own internal unit is one staff-line spacing, which its Vexflow
 * backend draws as this many CSS pixels at zoom 1; `Cursor.updateWidthAndStyle`
 * uses the same factor. */
export const osmdPxPerUnit = 10;

/** `relInMeasureTimestamp` is a fraction of a whole note, and the converter
 * counts `divisions` units to a quarter. */
const unitsPerWholeNote = divisions * 4;

/** Close enough to call the same grid position once floating point has been
 * through a `Fraction`'s `RealValue` and back. */
const positionTolerance = 0.01;

/** The width OSMD draws its own thin cursor at (`Cursor.ts`,
 * `CursorType.ThinLeft`), reproduced here so a self-drawn bar keeps exactly
 * that look. */
export function playheadWidth(zoom: number): number {
  return 5 * zoom;
}

/** Every written note's box, keyed by the source note ids it sounds for.
 * Walked once after the score has rendered: a note tied across a barline or a
 * doubled unison owns more than one box, which is why this is `id -> boxes`
 * rather than `id -> box`. Null for a written note OSMD did not end up
 * drawing (an unrendered page under lazy rendering, say), which just leaves
 * that id with nothing to highlight. */
export function buildMarks(
  osmd: OpenSheetMusicDisplay,
  writtenNotes: readonly WrittenNote[],
): ReadonlyMap<number, readonly ScoreMark[]> {
  const marks = new Map<number, ScoreMark[]>();
  const zoom = osmd.zoom;
  for (const written of writtenNotes) {
    const mark = findMark(osmd, written, zoom);
    if (mark === null) {
      continue;
    }
    for (const id of written.ids) {
      const list = marks.get(id);
      if (list === undefined) {
        marks.set(id, [mark]);
      } else {
        list.push(mark);
      }
    }
  }
  return marks;
}

function closestEntry(
  entries: readonly GraphicalStaffEntry[],
  positionInMeasure: number,
): GraphicalStaffEntry | null {
  let best: GraphicalStaffEntry | null = null;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const entry of entries) {
    const units = entry.relInMeasureTimestamp.RealValue * unitsPerWholeNote;
    const diff = Math.abs(units - positionInMeasure);
    if (diff < bestDiff) {
      best = entry;
      bestDiff = diff;
    }
  }
  return bestDiff <= positionTolerance ? best : null;
}

function findMark(
  osmd: OpenSheetMusicDisplay,
  written: WrittenNote,
  zoom: number,
): ScoreMark | null {
  const instrument = osmd.Sheet.Instruments[written.partIndex];
  const staff = instrument?.Staves[written.staff - 1];
  if (staff === undefined) {
    return null;
  }
  const measure = osmd.GraphicSheet.findGraphicalMeasure(
    written.measureIndex,
    staff.idInMusicSheet,
  );
  const system = measure?.ParentMusicSystem;
  const topStaffLine = system?.StaffLines[0];
  const bottomStaffLine = system?.StaffLines.at(-1);
  if (
    measure === undefined ||
    system === undefined ||
    topStaffLine === undefined ||
    bottomStaffLine === undefined
  ) {
    return null;
  }
  const entry = closestEntry(measure.staffEntries, written.positionInMeasure);
  if (entry === null) {
    return null;
  }

  const x = entry.PositionAndShape.AbsolutePosition.x;
  // The engraver aligns a whole system's parts and staves to the same beat
  // positions, so one moment's mark reads correctly against every staff in
  // the system it falls in without needing a box per staff: the box spans
  // from the top staff line to the bottom one, exactly as OSMD's own
  // standard cursor does (`Cursor.ts`, `update()`).
  const y =
    system.PositionAndShape.AbsolutePosition.y +
    topStaffLine.PositionAndShape.RelativePosition.y;
  const endY =
    system.PositionAndShape.AbsolutePosition.y +
    bottomStaffLine.PositionAndShape.RelativePosition.y +
    bottomStaffLine.StaffHeight;

  return {
    left: (x - 1.5) * osmdPxPerUnit * zoom,
    top: y * osmdPxPerUnit * zoom,
    height: (endY - y) * osmdPxPerUnit * zoom,
  };
}
