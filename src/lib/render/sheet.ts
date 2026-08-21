import type { OpenSheetMusicDisplay } from "opensheetmusicdisplay";
import { createNoteSweep } from "@/lib/midi/part";
import type { SongNote } from "@/lib/midi/song";
import { buildMarks, playheadWidth, type ScoreMark } from "@/lib/sheet/marks";
import {
  easedScroll,
  nextPlayhead,
  playheadScrollTarget,
} from "@/lib/sheet/playhead";
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

export type SheetPainter = {
  /** Blits the window of the score the current moment sits in, with the
   * reading bar over it. */
  draw(ctx: CanvasRenderingContext2D, position: number, stepMs: number): void;
  dispose(): void;
};

/** Engraves the whole score once at render resolution and hands back something
 * that only moves a window and one bar over it per frame. Null where the
 * engraver drew nothing, which leaves the render on the falling notes. */
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
    const relevant = notes.filter((note) => notation.noteIds.has(note.id));
    const sweep = createNoteSweep(relevant);
    // Kept as a bitmap rather than as a page: nothing is laid out again, and
    // the document is free of the score for the length of the render.
    score.remove();
    return painterOver(
      score,
      marks,
      playheadWidth(osmd.zoom),
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

function painterOver(
  score: HTMLCanvasElement,
  marks: ReadonlyMap<number, readonly ScoreMark[]>,
  barWidth: number,
  sweep: ReturnType<typeof createNoteSweep>,
  notation: RenderNotation,
  region: Region,
): SheetPainter {
  const { paper, playhead, playheadAlpha } = notation.colors;
  // The engraver lays the score down at the display's own density, so its
  // pixels are that much finer than the coordinates its marks stand in.
  const width = Number.parseFloat(score.style.width) || score.width;
  const density = score.width / width;
  const contentHeight = score.height / density;
  let scroll = 0;
  let standing: ScoreMark | null = null;
  return {
    draw(ctx, position, stepMs) {
      const jumped = sweep.moveTo(position);
      standing = nextPlayhead(standing, sweep.next, marks, jumped);
      if (standing !== null) {
        scroll = easedScroll(
          scroll,
          playheadScrollTarget(standing, region.height, contentHeight),
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
      if (standing !== null && standing.height > 0) {
        ctx.globalAlpha = playheadAlpha;
        ctx.fillStyle = playhead;
        ctx.fillRect(
          region.x + standing.left,
          region.y + standing.top - scroll,
          barWidth,
          standing.height,
        );
      }
      ctx.restore();
    },
    dispose(): void {
      score.width = 0;
      score.height = 0;
    },
  };
}
