import type { OpenSheetMusicDisplay } from "opensheetmusicdisplay";
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

/** The written moment being heard at this position, walked on from the one
 * before it so a frame costs a step rather than a scan. */
export function onsetIndexAt(
  onsets: readonly number[],
  position: number,
  from: number,
): number {
  let index = position < (onsets[from] ?? 0) ? 0 : from;
  while (
    index + 1 < onsets.length &&
    position >= (onsets[index + 1] ?? Number.POSITIVE_INFINITY)
  ) {
    index += 1;
  }
  return index;
}

/** Where a written moment stands on the engraved score, in the score's own
 * coordinates. Both markers share it: the engraver places them alike and each
 * carries its own width in the image it is drawn from. */
type Mark = {
  readonly x: number;
  readonly y: number;
  readonly height: number;
};

export type SheetPainter = {
  /** Blits the window of the score the current moment sits in, with the marker
   * on what is sounding and the one on what comes next. */
  draw(ctx: CanvasRenderingContext2D, position: number, stepMs: number): void;
  dispose(): void;
};

/** Engraves the whole score once at render resolution and hands back something
 * that only moves a window and two markers over it per frame. Null where the
 * engraver drew nothing, which leaves the render on the falling notes. */
export async function sheetPainter(
  notation: RenderNotation,
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
    const marks = readMarks(osmd, notation.music.cursorOnsets.length);
    const now = await cursorImage(osmd.cursor.cursorElement);
    const next = await cursorImage(osmd.cursors[1]?.cursorElement ?? null);
    // Kept as a bitmap rather than as a page: nothing is laid out again, and
    // the document is free of the score for the length of the render.
    score.remove();
    return painterOver(score, marks, now, next, notation, region);
  } finally {
    host.remove();
  }
}

async function engrave(
  host: HTMLDivElement,
  notation: RenderNotation,
): Promise<OpenSheetMusicDisplay> {
  const { OpenSheetMusicDisplay, CursorType } = await import(
    "opensheetmusicdisplay"
  );
  const { colors } = notation;
  const osmd = new OpenSheetMusicDisplay(host, {
    // A canvas leaves the engraver as pixels a frame can blit, where the svg
    // backend would have to be serialised and decoded to reach one.
    backend: "canvas",
    drawTitle: false,
    drawPartNames: false,
    drawComposer: false,
    followCursor: false,
    defaultColorMusic: colors.music,
    cursorsOptions: [
      {
        type: CursorType.Standard,
        color: colors.cursor,
        alpha: colors.cursorAlpha,
        follow: false,
      },
      {
        type: CursorType.ThinLeft,
        color: colors.next,
        alpha: colors.nextAlpha,
        follow: false,
      },
    ],
  });
  await osmd.load(notation.music.musicXml);
  osmd.render();
  osmd.cursor.show();
  osmd.cursors[1]?.show();
  return osmd;
}

/** Walks the cursor over the whole score once, so every frame after this is a
 * lookup. One mark per written moment, in the order the panel steps them. */
function readMarks(osmd: OpenSheetMusicDisplay, count: number): Mark[] {
  const marks: Mark[] = [];
  osmd.cursor.reset();
  for (let index = 0; index < count; index += 1) {
    marks.push(markOf(osmd.cursor.cursorElement));
    osmd.cursor.next();
  }
  return marks;
}

/** Sized off the attribute rather than off `height`, which answers with what an
 * element in a document is rendered at: the engraver draws a one pixel tall
 * image and stretches it to the staff, so the stylesheet's own
 * `img { height: auto }` reset would report every marker one pixel tall. */
function markOf(element: HTMLImageElement): Mark {
  return {
    x: Number.parseFloat(element.style.left) || 0,
    y: Number.parseFloat(element.style.top) || 0,
    height: Number.parseFloat(element.getAttribute("height") ?? "") || 0,
  };
}

/** The marker exactly as the panel wears it: the engraver hands each cursor out
 * as a one pixel tall gradient already carrying its colour and its
 * transparency, so a render stretches that rather than mixing its own. */
async function cursorImage(
  element: HTMLImageElement | null,
): Promise<HTMLImageElement | null> {
  const source = element?.src ?? "";
  if (source === "") {
    return null;
  }
  const image = new Image();
  image.src = source;
  await image.decode();
  return image;
}

function painterOver(
  score: HTMLCanvasElement,
  marks: readonly Mark[],
  now: HTMLImageElement | null,
  next: HTMLImageElement | null,
  notation: RenderNotation,
  region: Region,
): SheetPainter {
  const onsets = notation.music.cursorOnsets;
  const { paper } = notation.colors;
  // The engraver lays the score down at the display's own density, so its
  // pixels are that much finer than the coordinates its cursors stand in.
  const width = Number.parseFloat(score.style.width) || score.width;
  const density = score.width / width;
  const contentHeight = score.height / density;
  let scroll = 0;
  let index = 0;
  return {
    draw(ctx, position, stepMs) {
      index = onsetIndexAt(onsets, position, index);
      const mark = marks[index] ?? null;
      if (mark !== null) {
        scroll = easedScroll(
          scroll,
          sheetScrollTarget(mark.y, region.height, contentHeight),
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
      paintMark(ctx, now, mark, region, scroll);
      paintMark(ctx, next, marks[index + 1] ?? null, region, scroll);
      ctx.restore();
    },
    dispose(): void {
      score.width = 0;
      score.height = 0;
    },
  };
}

function paintMark(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement | null,
  mark: Mark | null,
  region: Region,
  scroll: number,
): void {
  if (image === null || mark === null || mark.height === 0) {
    return;
  }
  ctx.drawImage(
    image,
    region.x + mark.x,
    region.y + mark.y - scroll,
    image.naturalWidth,
    mark.height,
  );
}
