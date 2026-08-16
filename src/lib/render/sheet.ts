import type { OpenSheetMusicDisplay } from "opensheetmusicdisplay";
import { createNoteSweep } from "@/lib/midi/part";
import type { SongNote } from "@/lib/midi/song";
import {
  buildMarks,
  nextMarkWidth,
  nowMarkWidth,
  type ScoreMark,
} from "@/lib/sheet/marks";
import type { SheetColors } from "@/lib/sheet/theme";
import type { NotationView, SheetMusic, SheetTheme } from "@/lib/sheet/types";

/** The notation area of the watch view, as an offline render needs it: the
 * score itself, the look it is drawn in, and how much of the frame it takes.
 * Null anywhere the notation is off, or a song could not become one. */
export type RenderNotation = {
  readonly view: Exclude<NotationView, "off">;
  readonly theme: SheetTheme;
  readonly colors: SheetColors;
  readonly music: SheetMusic;
  /** Which of the song's own notes this score was written for, so a render
   * finds the same notes sounding the screen did. */
  readonly noteIds: ReadonlySet<number>;
};

export type Region = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type SceneRegions = {
  readonly sheet: Region | null;
  readonly roll: Region | null;
};

/** Notation reads across the page and the notes fall down it, so the two are
 * stacked and each keeps the whole width, exactly as the page arranges them. */
export function sceneRegions(
  view: NotationView,
  width: number,
  height: number,
): SceneRegions {
  const whole: Region = { x: 0, y: 0, width, height };
  if (view === "off") {
    return { sheet: null, roll: whole };
  }
  if (view === "full") {
    return { sheet: whole, roll: null };
  }
  const split = Math.round(height / 2);
  return {
    sheet: { x: 0, y: 0, width, height: split },
    roll: { x: 0, y: split, width, height: height - split },
  };
}

/** Where the current system settles: a third of the way down the panel, so
 * there is always more of what is coming than of what has passed. */
const followBand = 1 / 3;

export function sheetScrollTarget(
  cursorTop: number,
  viewHeight: number,
  contentHeight: number,
): number {
  const furthest = Math.max(0, contentHeight - viewHeight);
  return Math.max(0, Math.min(furthest, cursorTop - viewHeight * followBand));
}

/** Exponential time constant for the eased catch-up scroll, so it glides rather
 * than snapping even across a big jump. */
const followTauMs = 220;

/** Stepped by the frame the render is laying down rather than by a measured
 * one, so the same song scrolls the same way every time it is rendered. */
export function easedScroll(
  current: number,
  target: number,
  stepMs: number,
): number {
  return current + (target - current) * (1 - Math.exp(-stepMs / followTauMs));
}

export type SheetPainter = {
  /** Blits the window of the score the current moment sits in, with the
   * highlight on what is sounding and the one on what comes next. */
  draw(ctx: CanvasRenderingContext2D, position: number, stepMs: number): void;
  dispose(): void;
};

/** Engraves the whole score once at render resolution and hands back something
 * that only moves a window and two highlights over it per frame. Null where
 * the engraver drew nothing, which leaves the render on the falling notes. */
export async function sheetPainter(
  notation: RenderNotation,
  notes: readonly SongNote[],
  region: Region,
): Promise<SheetPainter | null> {
  const host = document.createElement("div");
  host.style.position = "absolute";
  host.style.left = "-99999px";
  host.style.top = "0";
  host.style.width = `${region.width}px`;
  document.body.appendChild(host);
  try {
    const osmd = await engrave(host, notation);
    const score = host.querySelector("canvas");
    if (score === null || score.width === 0 || score.height === 0) {
      return null;
    }
    const marks = buildMarks(osmd, notation.music.writtenNotes);
    const nowWidth = nowMarkWidth(osmd.zoom);
    const nextWidth = nextMarkWidth(osmd.zoom);
    const relevant = notes.filter((note) => notation.noteIds.has(note.id));
    const sweep = createNoteSweep(relevant);
    // Kept as a bitmap rather than as a page: nothing is laid out again, and
    // the document is free of the score for the length of the render.
    score.remove();
    return painterOver(
      score,
      marks,
      nowWidth,
      nextWidth,
      sweep,
      notation,
      region,
    );
  } finally {
    host.remove();
  }
}

async function engrave(
  host: HTMLDivElement,
  notation: RenderNotation,
): Promise<OpenSheetMusicDisplay> {
  const { OpenSheetMusicDisplay } = await import("opensheetmusicdisplay");
  const { colors } = notation;
  const osmd = new OpenSheetMusicDisplay(host, {
    // A canvas leaves the engraver as pixels a frame can blit, where the svg
    // backend would have to be serialised and decoded to reach one.
    backend: "canvas",
    drawTitle: false,
    drawPartNames: notation.music.partNames.length > 1,
    drawComposer: false,
    followCursor: false,
    defaultColorMusic: colors.music,
  });
  await osmd.load(notation.music.musicXml);
  osmd.render();
  return osmd;
}

function firstMark(
  ids: ReadonlySet<number>,
  marks: ReadonlyMap<number, readonly ScoreMark[]>,
): ScoreMark | null {
  for (const id of ids) {
    const box = marks.get(id)?.[0];
    if (box !== undefined) {
      return box;
    }
  }
  return null;
}

function painterOver(
  score: HTMLCanvasElement,
  marks: ReadonlyMap<number, readonly ScoreMark[]>,
  nowWidth: number,
  nextWidth: number,
  sweep: ReturnType<typeof createNoteSweep>,
  notation: RenderNotation,
  region: Region,
): SheetPainter {
  const { paper, cursor, cursorAlpha, next, nextAlpha } = notation.colors;
  // The engraver lays the score down at the display's own density, so its
  // pixels are that much finer than the coordinates its marks stand in.
  const width = Number.parseFloat(score.style.width) || score.width;
  const density = score.width / width;
  const contentHeight = score.height / density;
  let scroll = 0;
  let lastPosition = Number.NEGATIVE_INFINITY;
  const rewindSlack = 0.05;
  return {
    draw(ctx, position, stepMs) {
      if (position + rewindSlack < lastPosition) {
        sweep.seek(position);
      } else {
        sweep.advance(position);
      }
      lastPosition = position;

      const primary =
        firstMark(sweep.sounding, marks) ?? firstMark(sweep.next, marks);
      if (primary !== null) {
        scroll = easedScroll(
          scroll,
          sheetScrollTarget(primary.top, region.height, contentHeight),
          stepMs,
        );
      }
      ctx.save();
      ctx.beginPath();
      ctx.rect(region.x, region.y, region.width, region.height);
      ctx.clip();
      ctx.fillStyle = paper;
      ctx.fillRect(region.x, region.y, region.width, region.height);
      ctx.drawImage(
        score,
        0,
        scroll * density,
        region.width * density,
        region.height * density,
        region.x,
        region.y,
        region.width,
        region.height,
      );
      paintGroup(
        ctx,
        sweep.sounding,
        marks,
        region,
        scroll,
        nowWidth,
        cursor,
        cursorAlpha,
        true,
      );
      paintGroup(
        ctx,
        sweep.next,
        marks,
        region,
        scroll,
        nextWidth,
        next,
        nextAlpha,
        false,
      );
      ctx.restore();
    },
    dispose(): void {
      score.width = 0;
      score.height = 0;
    },
  };
}

function paintGroup(
  ctx: CanvasRenderingContext2D,
  ids: ReadonlySet<number>,
  marks: ReadonlyMap<number, readonly ScoreMark[]>,
  region: Region,
  scroll: number,
  width: number,
  color: string,
  alpha: number,
  faded: boolean,
): void {
  for (const id of ids) {
    const boxes = marks.get(id);
    if (boxes === undefined) {
      continue;
    }
    for (const box of boxes) {
      paintBox(ctx, box, region, scroll, width, color, alpha, faded);
    }
  }
}

function paintBox(
  ctx: CanvasRenderingContext2D,
  box: ScoreMark,
  region: Region,
  scroll: number,
  width: number,
  color: string,
  alpha: number,
  faded: boolean,
): void {
  if (box.height === 0) {
    return;
  }
  const x = region.x + box.left;
  const y = region.y + box.top - scroll;
  ctx.save();
  ctx.globalAlpha = alpha;
  if (faded) {
    const gradient = ctx.createLinearGradient(x, 0, x + width, 0);
    gradient.addColorStop(0, "transparent");
    gradient.addColorStop(0.2, color);
    gradient.addColorStop(0.8, color);
    gradient.addColorStop(1, "transparent");
    ctx.fillStyle = gradient;
  } else {
    ctx.fillStyle = color;
  }
  ctx.fillRect(x, y, width, box.height);
  ctx.restore();
}
