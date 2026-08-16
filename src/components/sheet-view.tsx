"use client";

import { Contrast, FileDown, LoaderCircle } from "lucide-react";
import type {
  IOSMDOptions,
  OpenSheetMusicDisplay,
} from "opensheetmusicdisplay";
import { useEffect, useMemo, useRef, useState } from "react";
import { createNoteSweep } from "@/lib/midi/part";
import type { Song, SongNote, Transpose } from "@/lib/midi/song";
import { loadSheetMusic } from "@/lib/sheet/load";
import { buildMarks, nextMarkWidth, type ScoreMark } from "@/lib/sheet/marks";
import { dragScroll, pageWidth } from "@/lib/sheet/page";
import { sheetColors } from "@/lib/sheet/theme";
import type { SheetMusic, SheetTheme } from "@/lib/sheet/types";

type SheetViewProps = {
  url: string;
  song: Song;
  /** The song's presented name, which is what a downloaded page is called. */
  title: string;
  transpose: Transpose;
  /** The song position in seconds, read every animation frame: the same
   * clock the falling notes read, so the notation highlight tracks it
   * exactly. */
  getPosition: () => number;
  playing: boolean;
  /** Which notes the page is for, so muting a track or practising one part
   * writes the score for what is being played. A fresh set every render
   * re-engraves the whole song. */
  noteIds: ReadonlySet<number>;
  onSeek: ((position: number) => void) | null;
  theme: SheetTheme;
  onTheme: (next: SheetTheme) => void;
};

type LoadState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly sheet: SheetMusic }
  | { readonly status: "failed"; readonly message: string };

function sheetButtonClass(theme: SheetTheme): string {
  const surface =
    theme === "light"
      ? "border-ink/20 bg-paper/70 text-ink/60"
      : "border-line-strong bg-panel/60 text-muted";
  return `rounded-lg border p-1.5 pointer-coarse:min-h-11 pointer-coarse:min-w-11 backdrop-blur transition-colors hover:border-accent hover:text-accent disabled:opacity-50 ${surface}`;
}

function shellClass(theme: SheetTheme): string {
  const surface =
    theme === "light" ? "bg-paper text-ink/70" : "bg-panel text-muted";
  return `flex h-full items-center justify-center px-4 text-center text-sm ${surface}`;
}

export function SheetView({
  url,
  song,
  title,
  transpose,
  getPosition,
  playing,
  noteIds,
  onSeek,
  theme,
  onTheme,
}: SheetViewProps) {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    void loadSheetMusic(url, song, transpose, noteIds)
      .then((sheet) => {
        if (!cancelled) {
          setState({ status: "ready", sheet });
        }
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setState({
          status: "failed",
          message:
            error instanceof Error
              ? error.message
              : "That song could not be turned into notation.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [url, song, transpose, noteIds]);

  // Identity, not the grid: which of the song's own notes this page's score
  // was written from, the same set `loadSheetMusic` handed the converter.
  const notes = useMemo(
    () => song.notes.filter((note) => noteIds.has(note.id)),
    [song, noteIds],
  );

  if (state.status === "loading") {
    return (
      <div data-testid="sheet-view" className={shellClass(theme)}>
        Loading notation
      </div>
    );
  }
  if (state.status === "failed") {
    return (
      <div data-testid="sheet-view" className={shellClass(theme)}>
        {state.message}
      </div>
    );
  }
  if (state.sheet.partNames.length === 0) {
    return (
      <div data-testid="sheet-view" className={shellClass(theme)}>
        Nothing playing here can be written as notation.
      </div>
    );
  }
  return (
    <Notation
      sheet={state.sheet}
      title={title}
      notes={notes}
      getPosition={getPosition}
      playing={playing}
      onSeek={onSeek}
      theme={theme}
      onTheme={onTheme}
    />
  );
}

/** Slack against a small clock jitter before treating a lower reading as a
 * seek backward and resetting the sweep, rather than the scheduler's normal
 * forward wobble. */
const rewindSlack = 0.05;

/** Where the current system settles once following is running: a third of
 * the way down the panel, so there is always more of what is coming than of
 * what has passed. */
const followBand = 1 / 3;

/** How long a scroll the user made by hand keeps following paused. */
const followResumeMs = 2200;

/** How long following chases a seek made while the music is stopped, which is
 * the one thing that moves the notation when nobody is playing. */
const followSeekMs = 1200;

/** Exponential time constant for the eased catch-up scroll, so it glides
 * rather than snapping even across a big jump. */
const followTauMs = 220;

function paddedContentWidth(element: HTMLElement): number {
  const style = getComputedStyle(element);
  const padding =
    Number.parseFloat(style.paddingLeft) +
    Number.parseFloat(style.paddingRight);
  return element.clientWidth - padding;
}

/** The panel's width the moment the score is about to be engraved, waited
 * for rather than read once: right after a view switch mounts this panel,
 * the flex layout that sizes it has not always settled yet, and engraving
 * into a zero-width container is a real, silent failure OSMD only reports to
 * the console. */
function measureContentWidth(element: HTMLElement): Promise<number> {
  const width = paddedContentWidth(element);
  if (width > 0) {
    return Promise.resolve(width);
  }
  return new Promise((resolve) => {
    const observer = new ResizeObserver(() => {
      const next = paddedContentWidth(element);
      if (next > 0) {
        observer.disconnect();
        resolve(next);
      }
    });
    observer.observe(element);
  });
}

function firstMark(
  ids: ReadonlySet<number>,
  marks: ReadonlyMap<number, readonly ScoreMark[]>,
): ScoreMark | null {
  for (const id of ids) {
    const boxes = marks.get(id);
    const box = boxes?.[0];
    if (box !== undefined) {
      return box;
    }
  }
  return null;
}

/** Grows a pool of absolutely positioned marker divs to however many boxes
 * this frame needs and hides the rest, rather than creating or destroying
 * any: a frame is a lookup and a few style writes. */
function paintMarks(
  host: HTMLDivElement,
  pool: HTMLDivElement[],
  ids: ReadonlySet<number>,
  marks: ReadonlyMap<number, readonly ScoreMark[]>,
  width: number,
  background: string,
  opacity: number,
  testId: string,
): void {
  let used = 0;
  for (const id of ids) {
    // Only where the note is struck. A tie is one note written in several
    // places, and marking every place it is held puts a marker in bars the
    // reader has nothing to play in.
    const mark = marks.get(id)?.[0];
    if (mark === undefined) {
      continue;
    }
    let element = pool[used];
    if (element === undefined) {
      element = document.createElement("div");
      element.style.position = "absolute";
      element.style.pointerEvents = "none";
      element.dataset.testid = testId;
      host.appendChild(element);
      pool.push(element);
    }
    element.style.left = `${mark.left}px`;
    element.style.top = `${mark.top}px`;
    element.style.width = `${width}px`;
    element.style.height = `${mark.height}px`;
    element.style.background = background;
    element.style.opacity = String(opacity);
    element.style.display = "block";
    used += 1;
  }
  for (let index = used; index < pool.length; index += 1) {
    const element = pool[index];
    if (element !== undefined) {
      element.style.display = "none";
    }
  }
}

function Notation({
  sheet,
  title,
  notes,
  getPosition,
  playing,
  onSeek,
  theme,
  onTheme,
}: {
  sheet: SheetMusic;
  title: string;
  notes: readonly SongNote[];
  getPosition: () => number;
  playing: boolean;
  onSeek: ((position: number) => void) | null;
  theme: SheetTheme;
  onTheme: (next: SheetTheme) => void;
}) {
  const isLocked = playing && onSeek !== null;
  const [saving, setSaving] = useState(false);
  // Engraving every page again is seconds of work, so the button says so and
  // refuses a second press until the file is handed over.
  const savePdf = async (): Promise<void> => {
    setSaving(true);
    try {
      const { downloadSheetPdf } = await import("@/lib/sheet/export-pdf");
      await downloadSheetPdf(sheet, title);
    } finally {
      setSaving(false);
    }
  };
  const hostRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const marksRef = useRef<ReadonlyMap<number, readonly ScoreMark[]>>(new Map());
  const nextWidthRef = useRef(0);
  const nextPoolRef = useRef<HTMLDivElement[]>([]);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setError(null);
    const host = hostRef.current;
    const scrollEl = scrollRef.current;
    if (host === null || scrollEl === null) {
      return;
    }
    host.innerHTML = "";
    nextPoolRef.current = [];
    void (async () => {
      try {
        const width = await measureContentWidth(scrollEl);
        if (cancelled) {
          return;
        }
        // A fixed pixel width, not a percentage: engraved once here, this
        // never changes again, so a later viewport resize has nothing to
        // make OSMD redo the whole layout for.
        host.style.width = `${pageWidth(width)}px`;
        const { OpenSheetMusicDisplay } = await import("opensheetmusicdisplay");
        if (cancelled) {
          return;
        }
        const colors = sheetColors(theme);
        const options: IOSMDOptions = {
          backend: "svg",
          drawTitle: false,
          // A score of several instruments has to say which line is which; one
          // player's own part is already named by the page it is on.
          drawPartNames: sheet.partNames.length > 1,
          drawComposer: false,
          // OSMD's own follow scrolls the page itself; the panel drives its own
          // eased, pausable scroll instead, so this stays off.
          followCursor: false,
          // Defaults on and re-engraves the whole score on every window
          // resize; the page width above is deliberately independent of the
          // viewport, so that listener has to stay off too.
          autoResize: false,
          defaultColorMusic: colors.music,
        };
        const osmd = new OpenSheetMusicDisplay(host, options);
        await osmd.load(sheet.musicXml);
        if (cancelled) {
          return;
        }
        osmd.render();
        osmdRef.current = osmd;
        marksRef.current = buildMarks(osmd, sheet.writtenNotes);
        nextWidthRef.current = nextMarkWidth(osmd.zoom);
        setReady(true);
      } catch {
        if (!cancelled) {
          setError("This song's notation could not be drawn.");
        }
      }
    })();
    return () => {
      cancelled = true;
      osmdRef.current = null;
    };
  }, [sheet, theme]);

  // A pointer held down and dragged pans the page directly, on a phone and on
  // a desktop alike; touch's own native panning is turned off on this element
  // so the two never fight over the same drag.
  useEffect(() => {
    if (!ready) {
      return;
    }
    const scrollEl = scrollRef.current;
    if (scrollEl === null) {
      return;
    }
    let pointerId: number | null = null;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    scrollEl.style.touchAction = "none";
    scrollEl.style.cursor = "grab";
    const onPointerDown = (event: PointerEvent): void => {
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      startLeft = scrollEl.scrollLeft;
      startTop = scrollEl.scrollTop;
      scrollEl.setPointerCapture(event.pointerId);
      scrollEl.style.cursor = "grabbing";
    };
    const onPointerMove = (event: PointerEvent): void => {
      if (pointerId !== event.pointerId) {
        return;
      }
      scrollEl.scrollLeft = dragScroll(
        startLeft,
        startX,
        event.clientX,
        scrollEl.scrollWidth - scrollEl.clientWidth,
      );
      scrollEl.scrollTop = dragScroll(
        startTop,
        startY,
        event.clientY,
        scrollEl.scrollHeight - scrollEl.clientHeight,
      );
    };
    const endDrag = (event: PointerEvent): void => {
      if (pointerId !== event.pointerId) {
        return;
      }
      pointerId = null;
      scrollEl.style.cursor = "grab";
    };
    scrollEl.addEventListener("pointerdown", onPointerDown);
    scrollEl.addEventListener("pointermove", onPointerMove);
    scrollEl.addEventListener("pointerup", endDrag);
    scrollEl.addEventListener("pointercancel", endDrag);
    return () => {
      scrollEl.removeEventListener("pointerdown", onPointerDown);
      scrollEl.removeEventListener("pointermove", onPointerMove);
      scrollEl.removeEventListener("pointerup", endDrag);
      scrollEl.removeEventListener("pointercancel", endDrag);
      scrollEl.style.touchAction = "";
      scrollEl.style.cursor = "";
    };
  }, [ready]);

  // Sweeps which of the song's own notes sound now and which come next on
  // the clock the falling notes already read, and paints the boxes those ids
  // own: no index, no stepping, a seek is simply a different set of ids. The
  // panel keeps the current system in view with an eased scroll that yields
  // to a scroll the listener makes by hand.
  const lastPosition = useRef(Number.NEGATIVE_INFINITY);
  const referenceMark = useRef<ScoreMark | null>(null);
  const expectedScrollTop = useRef(0);
  const lastManualScroll = useRef(Number.NEGATIVE_INFINITY);
  const lastFrameTime = useRef(0);
  const chaseUntil = useRef(Number.NEGATIVE_INFINITY);
  // Read inside the frame loop rather than listed as a dependency: restarting
  // that effect would otherwise reset the sweep every play and pause.
  const playingRef = useRef(playing);
  useEffect(() => {
    playingRef.current = playing;
    if (playing) {
      lastManualScroll.current = Number.NEGATIVE_INFINITY;
      return;
    }
    // Stopping stops the scroll with it, rather than letting the chase from
    // the last note reached carry the page on for another second.
    chaseUntil.current = Number.NEGATIVE_INFINITY;
  }, [playing]);
  useEffect(() => {
    if (!ready) {
      return;
    }
    const host = hostRef.current;
    const scrollEl = scrollRef.current;
    if (host === null) {
      return;
    }
    // A scroll still arrives from the keyboard while the pointer is refused,
    // and it is honoured on the same terms as any other: yielded to, rather
    // than dragged back on the next frame.
    const onScroll = (): void => {
      if (scrollEl === null) {
        return;
      }
      if (Math.abs(scrollEl.scrollTop - expectedScrollTop.current) > 2) {
        lastManualScroll.current = performance.now();
      }
    };
    scrollEl?.addEventListener("scroll", onScroll, { passive: true });

    const sweep = createNoteSweep(notes);
    lastPosition.current = Number.NEGATIVE_INFINITY;
    lastFrameTime.current = 0;
    referenceMark.current = null;
    // Emptied and redrawn, the panel is briefly short enough that the browser
    // clamps how far it was scrolled, which arrives as a scroll nobody made.
    // Taking the position as it stands now is what keeps that from reading as
    // a listener scrolling by hand and pausing the follow.
    expectedScrollTop.current = scrollEl?.scrollTop ?? 0;
    lastManualScroll.current = Number.NEGATIVE_INFINITY;

    const colors = sheetColors(theme);
    let frame = 0;
    const step = (): void => {
      const now = performance.now();
      const dt = lastFrameTime.current === 0 ? 16 : now - lastFrameTime.current;
      lastFrameTime.current = now;

      const position = getPosition();
      const isSeek = position + rewindSlack < lastPosition.current;
      if (isSeek) {
        sweep.seek(position);
      } else {
        sweep.advance(position);
      }
      lastPosition.current = position;

      const marks = marksRef.current;
      paintMarks(
        host,
        nextPoolRef.current,
        sweep.next,
        marks,
        nextWidthRef.current,
        colors.next,
        colors.nextAlpha,
        "sheet-mark-next",
      );

      if (scrollEl !== null) {
        const primary =
          firstMark(sweep.next, marks) ?? firstMark(sweep.sounding, marks);
        if (primary !== null) {
          const maxScroll = Math.max(
            0,
            scrollEl.scrollHeight - scrollEl.clientHeight,
          );
          const target = Math.max(
            0,
            Math.min(
              maxScroll,
              primary.top - scrollEl.clientHeight * followBand,
            ),
          );
          // A reached note is not the only reason to chase: a seek can land
          // back on a mark this panel already holds a reference to (the very
          // first note again, say), which leaves the reference identical
          // even though the reader plainly just asked to go there.
          if (referenceMark.current !== primary || isSeek) {
            referenceMark.current = primary;
            chaseUntil.current = now + followSeekMs;
            // Asking for a bar is asking to be taken to it, so a seek
            // outranks a scroll made a moment earlier. The two windows
            // overlap, and the older one would otherwise swallow it.
            if (!playingRef.current) {
              lastManualScroll.current = Number.NEGATIVE_INFINITY;
            }
          }
          const hasYielded = now - lastManualScroll.current < followResumeMs;
          const isFollowing = playingRef.current || now < chaseUntil.current;
          if (!hasYielded && isFollowing) {
            const alpha = 1 - Math.exp(-dt / followTauMs);
            scrollEl.scrollTop += (target - scrollEl.scrollTop) * alpha;
            expectedScrollTop.current = scrollEl.scrollTop;
          }
        }
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      scrollEl?.removeEventListener("scroll", onScroll);
    };
  }, [ready, notes, getPosition, theme]);

  return (
    <div data-testid="sheet-view" className="relative flex h-full">
      {/* A scroll container that stops being one loses where it was scrolled
          to, so the lock refuses the wheel and the finger and leaves the
          scrolling in place. Locked only while the reader can stop the music:
          a match hides the transport, and taking the page as well would leave
          nothing that moves the score at all. */}
      <div
        ref={scrollRef}
        data-testid="sheet-scroll"
        className={`relative h-full min-w-0 flex-1 overflow-auto px-3 py-4 ${
          isLocked ? "pointer-events-none" : ""
        } ${theme === "light" ? "bg-paper" : "bg-panel"}`}
      >
        {error === null ? null : (
          <div className={shellClass(theme)}>
            <span className="absolute inset-0 flex items-center justify-center">
              {error}
            </span>
          </div>
        )}
        {/* The engraver fills this with hundreds of unnamed paths for the staves,
            stems and beams. The falling notes carry the same music in a form a
            screen reader can already be told about, so this stays out of the
            tree rather than reading as a wall of graphics. Its width is set
            directly in the load effect, once, to the fixed page it engraves
            at: not a Tailwind class, since that width has to survive every
            later resize of this scroll container untouched. */}
        <div ref={hostRef} aria-hidden="true" className="relative" />
      </div>
      {/* Kept on the left, where nothing else in the page reaches: the focus
          exit and the header's own controls all live in the top right corner.
          `[data-tip]` in globals.css forces position:relative at the same
          specificity as the `absolute` utility, so the positioned element
          has to be a plain wrapper around the buttons that carry the tips. */}
      <div className="absolute top-2 left-2 z-10 flex gap-1.5">
        <button
          type="button"
          onClick={() => onTheme(theme === "light" ? "dark" : "light")}
          aria-pressed={theme === "light"}
          aria-label="Invert notation colours"
          data-tip={theme === "light" ? "Switch to dark" : "Switch to paper"}
          data-tip-side="bottom"
          data-tip-align="left"
          className={sheetButtonClass(theme)}
        >
          <Contrast className="size-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => void savePdf()}
          disabled={saving}
          aria-label="Download the sheet music"
          data-tip={saving ? "Preparing the pages" : "Download as a PDF"}
          data-tip-side="bottom"
          data-tip-align="left"
          className={sheetButtonClass(theme)}
        >
          {saving ? (
            <LoaderCircle
              className="size-3.5 animate-spin"
              aria-hidden="true"
            />
          ) : (
            <FileDown className="size-3.5" aria-hidden="true" />
          )}
        </button>
      </div>
    </div>
  );
}
